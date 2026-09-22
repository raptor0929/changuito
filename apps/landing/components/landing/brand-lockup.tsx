import styles from './landing.module.css';

/**
 * The home header uses the approved wordmark image alone.
 * Footer and closing keep the idle character with the name in type.
 */
export function BrandLockup({
  className,
  variant = 'character',
}: {
  className?: string;
  variant?: 'wordmark' | 'character';
}) {
  const classes = className ? `${styles.brand} ${className}` : styles.brand;
  if (variant === 'wordmark') return <Wordmark className={classes} />;
  return <CharacterMark className={classes} />;
}

function Wordmark({ className }: { className: string }) {
  return (
    <span className={className}>
      <img
        className={styles.logoWordmark}
        src="/brand/wordmark.png"
        alt="Changuito"
        width={1097}
        height={249}
        data-testid="landing-wordmark"
      />
    </span>
  );
}

function CharacterMark({ className }: { className: string }) {
  return (
    <span className={className}>
      <img
        className={styles.logoMark}
        src="/brand/mascot-idle.png"
        alt=""
        aria-hidden="true"
        width={397}
        height={583}
      />
      <span className={styles.logoWord}>Changuito</span>
    </span>
  );
}
