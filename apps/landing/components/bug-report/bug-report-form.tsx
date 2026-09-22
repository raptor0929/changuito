'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { SEVERITIES } from '../../lib/bug-report/options.ts';
import styles from './bug-report.module.css';

type FieldErrors = Partial<
  Record<'name' | 'email' | 'description' | 'context' | 'severity' | 'form', string>
>;

export function BugReportSuccess({ autoFocus = false }: { autoFocus?: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className={styles.success} data-testid="bug-report-success">
      <h2 ref={titleRef} className={styles.successTitle} tabIndex={-1}>
        Listo, lo recibimos
      </h2>
      <p className={styles.successLead}>Gracias por avisar. Lo vamos a mirar.</p>
      <a className={styles.again} href="/reportarbug">
        Contar otro
      </a>
    </div>
  );
}

export function BugReportForm({ notice }: { notice?: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [context, setContext] = useState('');
  const [severity, setSeverity] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorSummaryRef = useRef<HTMLParagraphElement>(null);
  const baseId = useId();

  useEffect(() => {
    if (done) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) {
      invalid.focus();
      return;
    }
    if (errors.form || notice) errorSummaryRef.current?.focus();
  }, [errors, done, notice]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const company = new FormData(event.currentTarget).get('company');
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
          company: typeof company === 'string' ? company : '',
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; errors?: FieldErrors };
      if (payload.ok) {
        setErrors({});
        setDone(true);
        return;
      }
      setErrors(payload.errors ?? { form: 'No pudimos recibir el reporte. Probá de nuevo en un rato.' });
    } catch {
      setErrors({ form: 'No pudimos recibir el reporte. Probá de nuevo en un rato.' });
    } finally {
      setPending(false);
    }
  }

  if (done) return <BugReportSuccess autoFocus />;

  const formNotice = errors.form ?? notice;
  const nameErrorId = `${baseId}-name-error`;
  const emailErrorId = `${baseId}-email-error`;
  const descriptionErrorId = `${baseId}-description-error`;
  const descriptionHintId = `${baseId}-description-hint`;
  const contextErrorId = `${baseId}-context-error`;
  const contextHintId = `${baseId}-context-hint`;
  const severityErrorId = `${baseId}-severity-error`;
  const severityHintId = `${baseId}-severity-hint`;

  return (
    <form
      ref={formRef}
      className={styles.form}
      action="/api/bug-report"
      method="post"
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
          rows={5}
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
          className={`${styles.control} ${styles.textarea}`}
          name="context"
          rows={3}
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
