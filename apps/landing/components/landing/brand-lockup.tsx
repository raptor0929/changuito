import styles from './landing.module.css';

/**
 * The mark is the locked idle character only. The name is type.
 * The lettering image is not used here.
 */
export function BrandLockup({ className }: { className?: string }) {
  const classes = className ? `${styles.brand} ${className}` : styles.brand;
  return (
    <span className={classes}>
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
