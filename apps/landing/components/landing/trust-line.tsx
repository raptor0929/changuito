import styles from './trust-line.module.css';

/**
 * One credit line for every public footer.
 * The year and the mark live in this sentence, so a second copyright line is not rendered.
 * Names are the link text. The wordmark in the sentence is not a link.
 */
export function TrustLine({ testId = 'trust-line' }: { testId?: string }) {
  return (
    <p className={styles.trust} data-testid={testId}>
      © 2026 Changuito® · Hecho en 🇦🇷 por{' '}
      <a href="https://www.linkedin.com/in/simonethg/" target="_blank" rel="noopener noreferrer">
        SimonethG
      </a>{' '}
      y{' '}
      <a href="https://www.linkedin.com/in/fabio-laura-yavi/" target="_blank" rel="noopener noreferrer">
        Fabio
      </a>
      .
    </p>
  );
}
