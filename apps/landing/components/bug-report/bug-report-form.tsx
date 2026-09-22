'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';

import {
  bytesToBase64,
  clientFileError,
  FILE_ACCEPT,
  formatBytes,
  unreadableFileMessage,
} from '../../lib/bug-report/attachments.ts';
import { ACCESSORY_PX, keyboardInset, scrollDeltaToClear } from '../../lib/bug-report/keyboard-inset.ts';
import { SEVERITIES } from '../../lib/bug-report/options.ts';
import styles from './bug-report.module.css';

type FieldErrors = Partial<
  Record<'name' | 'email' | 'description' | 'context' | 'severity' | 'attachments' | 'form', string>
>;

type SelectedFile = { id: string; file: File };

export function BugReportSuccess({
  titleRef,
  onAgain,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>;
  onAgain: () => void;
}) {
  return (
    <div className={styles.success} data-testid="bug-report-success">
      <h1 ref={titleRef} className={styles.successTitle} tabIndex={-1}>
        Listo, lo recibimos
      </h1>
      <p className={styles.successLead}>Gracias por avisar. Lo vamos a mirar.</p>
      <button type="button" className={styles.again} data-testid="bug-report-again" onClick={onAgain}>
        Reportar otro error
      </button>
    </div>
  );
}

export function BugReportForm({ notice, onSuccess }: { notice?: string; onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [context, setContext] = useState('');
  const [severity, setSeverity] = useState('');
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorSummaryRef = useRef<HTMLParagraphElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileSeq = useRef(0);
  const baseId = useId();

  useEffect(() => {
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) {
      invalid.focus();
      return;
    }
    if (errors.form || notice) errorSummaryRef.current?.focus();
  }, [errors, notice]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

    const vv = window.visualViewport;
    let timer = 0;

    const settle = () => {
      const layout = window.innerHeight;
      const visual = vv?.height ?? layout;
      if (keyboardInset(layout, visual) <= 0) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !form.contains(active)) return;
      if (!active.matches('input, textarea, select')) return;
      if (active.closest('[aria-hidden="true"]')) return;
      const scroller = form.closest<HTMLElement>('[data-testid="bug-report-screen"]');
      if (!scroller) return;
      const target = active.closest<HTMLElement>(`.${CSS.escape(styles.field)}`) ?? active;
      const rect = target.getBoundingClientRect();
      const delta = scrollDeltaToClear(rect.top, rect.height, 12, visual - ACCESSORY_PX);
      if (delta !== 0) scroller.scrollBy({ top: delta, left: 0, behavior: 'auto' });
    };

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, delay);
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches('input, textarea, select')) return;
      if (target.closest('[aria-hidden="true"]')) return;
      schedule(320);
    };

    const onViewport = () => schedule(80);

    form.addEventListener('focusin', onFocusIn);
    vv?.addEventListener('resize', onViewport);
    window.addEventListener('orientationchange', onViewport);

    return () => {
      window.clearTimeout(timer);
      form.removeEventListener('focusin', onFocusIn);
      vv?.removeEventListener('resize', onViewport);
      window.removeEventListener('orientationchange', onViewport);
    };
  }, []);

  function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    const next = [...files];
    let problem: string | undefined;
    for (const file of picked) {
      const error = clientFileError(file, {
        count: next.length,
        bytes: next.reduce((sum, item) => sum + item.file.size, 0),
      });
      if (error) {
        problem = error;
        break;
      }
      fileSeq.current += 1;
      next.push({ id: String(fileSeq.current), file });
    }
    setFiles(next);
    setErrors((current) => ({ ...current, attachments: problem }));
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
    setErrors((current) => ({ ...current, attachments: undefined }));
    fileInputRef.current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const company = new FormData(event.currentTarget).get('company');
    let adjuntos: { name: string; mimeType: string; base64: string }[];
    try {
      adjuntos = await Promise.all(
        files.map(async (item) => ({
          name: item.file.name,
          mimeType: item.file.type,
          base64: bytesToBase64(new Uint8Array(await item.file.arrayBuffer())),
        })),
      );
    } catch {
      setErrors({ attachments: unreadableFileMessage() });
      setPending(false);
      return;
    }
    try {
      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name,
          email,
          description,
          context,
          severity,
          adjuntos,
          company: typeof company === 'string' ? company : '',
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; errors?: FieldErrors };
      if (payload.ok) {
        setErrors({});
        onSuccess();
        return;
      }
      setErrors(payload.errors ?? { form: 'No pudimos recibir el reporte. Probá de nuevo en un rato.' });
    } catch {
      setErrors({ form: 'No pudimos recibir el reporte. Probá de nuevo en un rato.' });
    } finally {
      setPending(false);
    }
  }

  const formNotice = errors.form ?? notice;
  const nameErrorId = `${baseId}-name-error`;
  const emailErrorId = `${baseId}-email-error`;
  const descriptionErrorId = `${baseId}-description-error`;
  const descriptionHintId = `${baseId}-description-hint`;
  const contextErrorId = `${baseId}-context-error`;
  const contextHintId = `${baseId}-context-hint`;
  const severityErrorId = `${baseId}-severity-error`;
  const severityHintId = `${baseId}-severity-hint`;
  const attachmentsErrorId = `${baseId}-attachments-error`;
  const attachmentsHintId = `${baseId}-attachments-hint`;
  const attachmentsStatusId = `${baseId}-attachments-status`;
  const attachmentsDescribedBy = [
    attachmentsHintId,
    attachmentsStatusId,
    errors.attachments ? attachmentsErrorId : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <form
      ref={formRef}
      className={styles.form}
      action="/api/bug-report"
      method="post"
      encType="multipart/form-data"
      onSubmit={onSubmit}
      noValidate
      data-testid="bug-report-form"
    >
      {formNotice ? (
        <p
          ref={errorSummaryRef}
          className={styles.formError}
          role="alert"
          tabIndex={-1}
          data-testid="bug-report-form-error"
        >
          {formNotice}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-name`}>
          Nombre
        </label>
        <input
          id={`${baseId}-name`}
          className={styles.control}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={name}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? nameErrorId : undefined}
          data-testid="bug-report-name"
          onChange={(event) => setName(event.target.value)}
          required
        />
        {errors.name ? (
          <p id={nameErrorId} className={styles.fieldError} role="alert" data-testid="bug-report-name-error">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-email`}>
          Email
        </label>
        <input
          id={`${baseId}-email`}
          className={styles.control}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={email}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? emailErrorId : undefined}
          data-testid="bug-report-email"
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        {errors.email ? (
          <p id={emailErrorId} className={styles.fieldError} role="alert" data-testid="bug-report-email-error">
            {errors.email}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-description`}>
          Qué pasó
        </label>
        <p id={descriptionHintId} className={styles.hint}>
          Qué viste, y qué esperabas que pase.
        </p>
        <textarea
          id={`${baseId}-description`}
          className={`${styles.control} ${styles.textarea}`}
          name="description"
          rows={3}
          maxLength={2000}
          value={description}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={
            errors.description ? `${descriptionHintId} ${descriptionErrorId}` : descriptionHintId
          }
          data-testid="bug-report-description"
          onChange={(event) => setDescription(event.target.value)}
          required
        />
        {errors.description ? (
          <p
            id={descriptionErrorId}
            className={styles.fieldError}
            role="alert"
            data-testid="bug-report-description-error"
          >
            {errors.description}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-context`}>
          Dónde pasó (opcional)
        </label>
        <p id={contextHintId} className={styles.hint}>
          Una página, un enlace, o cómo repetirlo.
        </p>
        <textarea
          id={`${baseId}-context`}
          className={`${styles.control} ${styles.textarea} ${styles.textareaShort}`}
          name="context"
          rows={2}
          maxLength={500}
          value={context}
          aria-invalid={errors.context ? true : undefined}
          aria-describedby={errors.context ? `${contextHintId} ${contextErrorId}` : contextHintId}
          data-testid="bug-report-context"
          onChange={(event) => setContext(event.target.value)}
        />
        {errors.context ? (
          <p id={contextErrorId} className={styles.fieldError} role="alert" data-testid="bug-report-context-error">
            {errors.context}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-severity`}>
          Qué tan grave (opcional)
        </label>
        <p id={severityHintId} className={styles.hint}>
          Si no estás seguro, podés saltearlo.
        </p>
        <select
          id={`${baseId}-severity`}
          className={styles.control}
          name="severity"
          value={severity}
          aria-invalid={errors.severity ? true : undefined}
          aria-describedby={errors.severity ? `${severityHintId} ${severityErrorId}` : severityHintId}
          data-testid="bug-report-severity"
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="">Prefiero no decir</option>
          {SEVERITIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {errors.severity ? (
          <p id={severityErrorId} className={styles.fieldError} role="alert" data-testid="bug-report-severity-error">
            {errors.severity}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-attachments`}>
          Adjuntá una foto o un video (opcional)
        </label>
        <p id={attachmentsHintId} className={styles.hint}>
          JPG, PNG, WEBP, GIF, MP4, WEBM o MOV. Hasta 3 archivos, y 3 MB en total.
        </p>
        <input
          ref={fileInputRef}
          id={`${baseId}-attachments`}
          className={styles.fileInput}
          name="attachments"
          type="file"
          accept={FILE_ACCEPT}
          multiple
          aria-invalid={errors.attachments ? true : undefined}
          aria-describedby={attachmentsDescribedBy}
          data-testid="bug-report-attachments"
          onChange={onPickFiles}
        />
        <div id={attachmentsStatusId} aria-live="polite" data-testid="bug-report-files">
          {files.length === 0 ? (
            <p className={styles.hint}>Ningún archivo seleccionado.</p>
          ) : (
            <ul className={styles.fileList}>
              {files.map((item) => (
                <li key={item.id} className={styles.fileItem}>
                  <span className={styles.fileName}>
                    {item.file.name} ({formatBytes(item.file.size)})
                  </span>
                  <button
                    className={styles.fileRemove}
                    type="button"
                    aria-label={`Quitar ${item.file.name}`}
                    data-testid="bug-report-file-remove"
                    onClick={() => removeFile(item.id)}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {errors.attachments ? (
          <p
            id={attachmentsErrorId}
            className={styles.fieldError}
            role="alert"
            data-testid="bug-report-attachments-error"
          >
            {errors.attachments}
          </p>
        ) : null}
      </div>

      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={`${baseId}-company`}>Empresa</label>
        <input
          id={`${baseId}-company`}
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <button className={styles.submit} type="submit" disabled={pending} data-testid="bug-report-submit">
        {pending ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  );
}
