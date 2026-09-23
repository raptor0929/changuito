import { FOUNDERS } from '../../lib/copy';

import styles from './founder-line.module.css';

type Props = {
  className: string;
};

/**
 * Quiet attribution under a page. The accessible name of each link is its
 * visible label. The links stay inline in the sentence so a phone does not
 * turn them into a navigation row.
 */
export function FounderLine({ className }: Props) {
  const [simoneth, fabio] = FOUNDERS;

  return (
    <p className={className} data-testid="founder-trust">
      © 2026 Changuito® · Hecho en 🇦🇷 por{' '}
      <a className={styles.link} href={simoneth.href} target="_blank" rel="noopener noreferrer">
        {simoneth.name}
      </a>
      {' y '}
      <a className={styles.link} href={fabio.href} target="_blank" rel="noopener noreferrer">
        {fabio.name}
      </a>
      .
    </p>
  );
}
