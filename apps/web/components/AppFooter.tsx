/**
 * Quiet strip above the composer.
 *
 * The bug link used to sit at the end of the thread, so it scrolled away
 * and a second copy on the human gate was the only other place it lived.
 * The strip stays in view: one line, identifiers only, no prices.
 *
 * Social icons stay off this strip. The landing X mark is a close glyph,
 * and a second row would sit on the composer.
 */

type FooterLinkProps = {
  href: string;
  testId: string;
  className?: string;
  children: string;
};

function FooterLink({ href, testId, className, children }: FooterLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId} className={className}>
      {children}
    </a>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer" data-testid="app-footer" aria-label="Pie">
      <p className="app-footer-line">
        <span className="app-footer-trust">
          © 2026 Changuito® · Hecho en 🇦🇷 por{' '}
          <FooterLink href="https://www.linkedin.com/in/simonethg/" testId="footer-simoneth">
            SimonethG
          </FooterLink>{' '}
          y{' '}
          <FooterLink href="https://www.linkedin.com/in/fabio-laura-yavi/" testId="footer-fabio">
            Fabio
          </FooterLink>
          .
        </span>
        <span className="app-footer-sep" aria-hidden="true">
          ·
        </span>
        <FooterLink href="https://www.changuito.me/reportarbug" testId="report-bug">
          Reportar un bug
        </FooterLink>
        <span className="app-footer-sep app-footer-site-sep" aria-hidden="true">
          ·
        </span>
        <FooterLink className="app-footer-site" href="https://www.changuito.me/" testId="footer-site">
          www.changuito.me
        </FooterLink>
      </p>
    </footer>
  );
}
