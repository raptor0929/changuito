import {
  COPYRIGHT_LINE,
  FOUNDER_END,
  FOUNDER_JOIN,
  FOUNDER_PREFIX,
  FOUNDERS,
  NEW_TAB_HINT,
  TRUST_SEPARATOR,
} from '../lib/founder-trust-copy';

type Props = {
  className?: string;
};

/**
 * Quiet trust line. Wide footers are one sentence, copyright first.
 * Narrow footers stack the founder sentence above the copyright line.
 * The registered mark is printed once either way.
 *
 * The accessible name of each link starts with the visible name.
 * Reading order stays copyright, then the names.
 */
export function FounderTrust({ className }: Props) {
  const [simoneth, fabio] = FOUNDERS;
  const classes = className ? `chg-trust ${className}` : 'chg-trust';

  return (
    <div className={classes} data-testid="founder-trust">
      <p className="chg-trust-line">
        <span className="chg-trust-copy">{COPYRIGHT_LINE}</span>
        <span className="chg-trust-sep" aria-hidden="true">
          {TRUST_SEPARATOR}
        </span>
        <span className="chg-trust-made">
          {FOUNDER_PREFIX}
          <FounderLink href={simoneth.href} name={simoneth.name} />
          {FOUNDER_JOIN}
          <FounderLink href={fabio.href} name={fabio.name} />
          {FOUNDER_END}
        </span>
      </p>
    </div>
  );
}

function FounderLink({ href, name }: { href: string; name: string }) {
  return (
    <a className="chg-trust-link" href={href} target="_blank" rel="noopener noreferrer">
      {name}
      <span className="chg-trust-sr"> ({NEW_TAB_HINT})</span>
    </a>
  );
}
