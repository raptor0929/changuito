import { APP_URL, HERO } from '../../lib/copy';

import styles from './landing.module.css';

export function TryLink({ testId }: { testId: string }) {
  return (
    <a className={styles.cta} href={APP_URL} rel="noopener noreferrer" data-testid={testId}>
      {HERO.cta}
      {/* Decorative stand-in for the old arrow. The link name stays the CTA text. */}
      <img
        className={styles.ctaMascot}
        src="/brand/mascota-corriendo.png"
        alt=""
        aria-hidden="true"
        width={630}
        height={560}
        decoding="async"
      />
    </a>
  );
}
