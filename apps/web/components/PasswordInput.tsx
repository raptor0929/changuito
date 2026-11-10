'use client';

import { useState, type ChangeEvent } from 'react';

import { inLang } from '../lib/lang.ts';
import { useLang } from './LangProvider';

/**
 * A password box with an eye to show what was typed. The Día password is
 * typed once, on a phone as often as not, and a typo there is a run that
 * stops at Día's login page — so the shopper gets to check it.
 *
 * Shown is a choice per box and per visit: it starts hidden every time and
 * nothing remembers it. The eye is a toggle button (`aria-pressed`) beside the
 * input, inside the same label, so the label still names the input.
 */
export function PasswordInput({
  value,
  onChange,
  autoComplete = 'new-password',
  placeholder,
  testId,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  placeholder?: string;
  testId?: string;
}) {
  const lang = useLang();
  const [shown, setShown] = useState(false);
  return (
    <span className="ck-secret">
      <input
        className="ck-input"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        data-testid={testId}
      />
      <button
        type="button"
        className="ck-eye"
        aria-pressed={shown}
        aria-label={inLang(lang, { es: 'Mostrar contraseña', en: 'Show password' })}
        title={shown ? inLang(lang, { es: 'Ocultar', en: 'Hide' }) : inLang(lang, { es: 'Mostrar', en: 'Show' })}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

function EyeIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.1 4.1" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
