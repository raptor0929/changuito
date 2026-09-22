'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';

import { NAV } from '../../lib/copy';
import { TryLink } from './try-link';
import styles from './landing.module.css';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={styles.header} data-testid="landing-header">
      <div className={styles.headerInner}>
        <a className={styles.logoLink} href="/">
          <Image
            src="/brand/wordmark.png"
            alt="Changuito"
            width={1097}
            height={249}
            priority
            className={styles.wordmark}
          />
        </a>
        <button
          ref={buttonRef}
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls={navId}
          data-testid="landing-nav-toggle"
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.srOnly}>{open ? 'Cerrar menú' : 'Abrir menú'}</span>
          <MenuGlyph open={open} />
        </button>
        <nav
          id={navId}
          className={open ? `${styles.nav} ${styles.isOpen}` : styles.nav}
          aria-label="Principal"
          data-testid="landing-nav"
        >
          <ul className={styles.navList}>
            {NAV.map((link) => (
              <li key={link.href}>
                <a className={styles.navLink} href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <TryLink testId="landing-cta-header" />
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className={styles.menuGlyph}>
      {open ? (
        <path
          d="M6 6l12 12M18 6L6 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M4 7h16M4 12h16M4 17h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
