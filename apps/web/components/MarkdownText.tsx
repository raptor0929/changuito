'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Lightweight markdown for agent replies: **bold**, *italic*, `code`,
 * and `-` / `*` bullet lists. No HTML passthrough — only these tokens
 * become elements, everything else stays text.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // **bold** | *italic* | `code` — non-greedy, same-line
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const k = `${keyPrefix}-${i++}`;
    if (m[2] !== undefined) nodes.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={k}>{m[3]}</em>);
    else if (m[4] !== undefined) nodes.push(<code key={k}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isBullet(line: string): boolean {
  return /^\s*[-*]\s+/.test(line);
}

function bulletText(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '');
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    if (isBullet(lines[i]!)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i]!)) {
        items.push(
          <li key={`li-${b}-${i}`}>{inline(bulletText(lines[i]!), `li-${b}-${i}`)}</li>,
        );
        i++;
      }
      blocks.push(
        <ul key={`ul-${b++}`} className="say-list">
          {items}
        </ul>,
      );
      continue;
    }

    // Blank line → spacer between paragraphs
    if (lines[i]!.trim() === '') {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !isBullet(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={`p-${b++}`} className="say-p">
        {para.map((line, li) => (
          <Fragment key={`l-${li}`}>
            {li > 0 ? <br /> : null}
            {inline(line, `p-${b}-${li}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="say">{blocks}</div>;
}
