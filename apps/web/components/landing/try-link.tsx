import { APP_URL, HERO } from '../../lib/landing';

import styles from './landing.module.css';

export function TryLink({ testId }: { testId: string }) {
  return (
    <a className={styles.cta} href={APP_URL} rel="noopener noreferrer" data-testid={testId}>
      {HERO.cta}
      <img
        src="/brand/mascota-corriendo.png"
        alt=""
        width={630}
        height={560}
        className={styles.ctaMascot}
        decoding="async"
      />
    </a>
  );
}
