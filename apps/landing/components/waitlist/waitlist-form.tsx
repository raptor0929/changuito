'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { OTHER_SOURCE, SOURCE_GROUPS } from '../../lib/waitlist/options.ts';
import styles from './waitlist.module.css';

type FieldErrors = Partial<
  Record<'name' | 'email' | 'source' | 'otherDetail' | 'contactForFeedback' | 'whatsapp' | 'form', string>
>;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';

export function WaitlistForm({ notice }: { notice?: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [otherDetail, setOtherDetail] = useState('');
  const [contactForFeedback, setContactForFeedback] = useState<'si' | 'no' | ''>('');
  const [whatsapp, setWhatsapp] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLParagraphElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const baseId = useId();

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  useEffect(() => {
    if (done) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) {
      invalid.focus();
      return;
    }
    if (errors.form || notice) errorSummaryRef.current?.focus();
  }, [errors, done, notice]);

  useEffect(() => {
    if (!SITE_KEY || !turnstileRef.current) return;

    let cancelled = false;

    function mount() {
      if (cancelled || !turnstileRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
        theme: 'light',
      });
    }

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', mount);
      } else {
        const script = document.createElement('script');
        script.src = TURNSTILE_SRC;
        script.async = true;
        script.onload = mount;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  function resetTurnstile() {
    setTurnstileToken('');
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const company = new FormData(event.currentTarget).get('company');
    try {
      const response = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name,
          email,
          source,
          otherDetail,
          contactForFeedback,
          whatsapp: contactForFeedback === 'si' ? whatsapp : '',
          company: typeof company === 'string' ? company : '',
          turnstileToken,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; errors?: FieldErrors };
      if (payload.ok) {
        setErrors({});
        setDone(true);
        return;
      }
      setErrors(payload.errors ?? { form: 'No pudimos anotarte. Probá de nuevo en un rato.' });
      resetTurnstile();
    } catch {
      setErrors({ form: 'No pudimos anotarte. Probá de nuevo en un rato.' });
      resetTurnstile();
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className={styles.success} data-testid="whitelist-success">
        <h2 ref={successRef} className={styles.successTitle} tabIndex={-1}>
          Listo, te anotamos
        </h2>
        <p className={styles.successLead}>Te avisamos por mail cuando puedas probar Changuito.</p>
      </div>
    );
  }

  const showOther = source === OTHER_SOURCE;
  const formNotice = errors.form ?? notice;
  const nameErrorId = `${baseId}-name-error`;
  const emailErrorId = `${baseId}-email-error`;
  const sourceErrorId = `${baseId}-source-error`;
  const otherErrorId = `${baseId}-other-error`;
  const contactErrorId = `${baseId}-contact-error`;
  const whatsappErrorId = `${baseId}-whatsapp-error`;

  return (
    <form
      ref={formRef}
      className={styles.form}
      action="/api/whitelist"
      method="post"
      onSubmit={onSubmit}
      noValidate
      data-testid="whitelist-form"
    >
      {formNotice ? (
        <p
          ref={errorSummaryRef}
          className={styles.formError}
          role="alert"
          tabIndex={-1}
          data-testid="whitelist-form-error"
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
          data-testid="whitelist-name"
          onChange={(event) => setName(event.target.value)}
          required
        />
        {errors.name ? (
          <p id={nameErrorId} className={styles.fieldError} role="alert" data-testid="whitelist-name-error">
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
          data-testid="whitelist-email"
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        {errors.email ? (
          <p id={emailErrorId} className={styles.fieldError} role="alert" data-testid="whitelist-email-error">
            {errors.email}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${baseId}-source`}>
          ¿Dónde te enteraste de nosotros?
        </label>
        <select
          id={`${baseId}-source`}
          className={styles.control}
          name="source"
          value={source}
          aria-invalid={errors.source ? true : undefined}
          aria-describedby={errors.source ? sourceErrorId : undefined}
          data-testid="whitelist-source"
          onChange={(event) => setSource(event.target.value)}
          required
        >
          <option value="">Elegí una opción</option>
          {SOURCE_GROUPS.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {errors.source ? (
          <p id={sourceErrorId} className={styles.fieldError} role="alert" data-testid="whitelist-source-error">
            {errors.source}
          </p>
        ) : null}
      </div>

      <div className={`${styles.field} ${styles.other}`}>
        <label className={styles.label} htmlFor={`${baseId}-other`}>
          Contanos dónde
        </label>
        <input
          id={`${baseId}-other`}
          className={styles.control}
          name="otherDetail"
          type="text"
          maxLength={160}
          value={otherDetail}
          aria-invalid={errors.otherDetail ? true : undefined}
          aria-describedby={errors.otherDetail ? otherErrorId : undefined}
          data-testid="whitelist-other"
          onChange={(event) => setOtherDetail(event.target.value)}
          required={showOther}
        />
        {errors.otherDetail ? (
          <p id={otherErrorId} className={styles.fieldError} role="alert" data-testid="whitelist-other-error">
            {errors.otherDetail}
          </p>
        ) : null}
      </div>

      <fieldset
        className={styles.fieldset}
        aria-invalid={errors.contactForFeedback ? true : undefined}
        aria-describedby={errors.contactForFeedback ? contactErrorId : undefined}
        data-testid="whitelist-contact"
      >
        <legend className={styles.label}>¿Te gustaría que te contactemos para que nos des feedback?</legend>
        <div className={styles.radioRow}>
          <label className={styles.radio}>
            <input
              type="radio"
              name="contactForFeedback"
              value="si"
              checked={contactForFeedback === 'si'}
              data-testid="whitelist-contact-si"
              onChange={() => {
                setContactForFeedback('si');
              }}
              required
            />
            Sí
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="contactForFeedback"
              value="no"
              checked={contactForFeedback === 'no'}
              data-testid="whitelist-contact-no"
              onChange={() => {
                setContactForFeedback('no');
                setWhatsapp('');
              }}
              required
            />
            No
          </label>
        </div>
        {errors.contactForFeedback ? (
          <p id={contactErrorId} className={styles.fieldError} role="alert" data-testid="whitelist-contact-error">
            {errors.contactForFeedback}
          </p>
        ) : null}
      </fieldset>

      <div className={`${styles.field} ${styles.whatsapp}`}>
        <label className={styles.label} htmlFor={`${baseId}-whatsapp`}>
          WhatsApp (opcional)
        </label>
        <input
          id={`${baseId}-whatsapp`}
          className={styles.control}
          name="whatsapp"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={24}
          value={whatsapp}
          placeholder="+54 9 11 1234 5678"
          aria-invalid={errors.whatsapp ? true : undefined}
          aria-describedby={errors.whatsapp ? whatsappErrorId : undefined}
          data-testid="whitelist-whatsapp"
          onChange={(event) => setWhatsapp(event.target.value)}
        />
        {errors.whatsapp ? (
          <p id={whatsappErrorId} className={styles.fieldError} role="alert" data-testid="whitelist-whatsapp-error">
            {errors.whatsapp}
          </p>
        ) : null}
      </div>

      {SITE_KEY ? (
        <div className={styles.turnstile} data-testid="whitelist-turnstile">
          <div ref={turnstileRef} />
          <input type="hidden" name="turnstileToken" value={turnstileToken} />
        </div>
      ) : null}

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

      <button className={styles.submit} type="submit" disabled={pending} data-testid="whitelist-submit">
        {pending ? 'Anotando…' : 'Anotame'}
      </button>
    </form>
  );
}
