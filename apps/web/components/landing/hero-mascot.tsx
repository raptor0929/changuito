import styles from './landing.module.css';

/**
 * Brand Kit `animacion-cargando.gif`: groceries arc into the cart and the
 * mascot bounces when they land. A GIF ignores CSS animation: none, so
 * reduced motion swaps in one frame of the same loop via `<picture>`.
 * Next/Image would flatten the GIF, so this stays a plain image.
 */
export const HERO_MOTION_SRC = '/brand/animacion-cargando.gif';
export const HERO_STILL_SRC = '/brand/mascot-cargando-still.png';

export function HeroMascot() {
  return (
    <div className={styles.mascotFrame}>
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet={HERO_STILL_SRC} />
        <img
          src={HERO_MOTION_SRC}
          alt="Changuito, un carrito con pan, verdes y un mate"
          width={480}
          height={360}
          className={styles.mascot}
          decoding="async"
          fetchPriority="high"
          data-testid="landing-hero-mascot"
        />
      </picture>
    </div>
  );
}
