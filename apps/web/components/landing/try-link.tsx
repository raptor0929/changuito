import { APP_URL, HERO } from '../../lib/landing';

import styles from './landing.module.css';

export function TryLink({ testId }: { testId: string }) {
  return (
    <a className={styles.cta} href={APP_URL} rel="noopener noreferrer" data-testid={testId}>
      {HERO.cta}
      <span aria-hidden="true" className={styles.ctaArrow}>
        →
      </span>
    </a>
  );
}
