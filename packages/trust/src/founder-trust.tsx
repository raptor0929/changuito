import {
  COPYRIGHT_LINE,
  FOUNDER_END,
  FOUNDER_JOIN,
  FOUNDER_PREFIX,
  FOUNDERS,
  NEW_TAB_HINT,
  TRUST_SEPARATOR,
} from './copy.ts';

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
const TRUST_CSS = `
.chg-trust{container-type:inline-size;container-name:chg-trust}
.chg-trust-line{margin:0}
.chg-trust-link{color:inherit;font:inherit;text-decoration:underline;text-underline-offset:2px}
.chg-trust-link:hover{text-decoration-thickness:2px}
.chg-trust-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@container chg-trust (max-width: 36rem){
  .chg-trust-line{display:flex;flex-direction:column-reverse}
  .chg-trust-sep{display:none}
}
`;

export function FounderTrust({ className }: Props) {
  const [simoneth, fabio] = FOUNDERS;
  const classes = className ? `chg-trust ${className}` : 'chg-trust';

  return (
    <div className={classes} data-testid="founder-trust">
      <style href="changuito-founder-trust" precedence="default">
        {TRUST_CSS}
      </style>
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
