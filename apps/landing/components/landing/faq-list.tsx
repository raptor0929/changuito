'use client';

import { useId, useState } from 'react';

import { FAQ } from '../../lib/copy';

import styles from './landing.module.css';

export function FaqList() {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());

  function toggle(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className={styles.faqList} data-testid="landing-faq-list">
      {FAQ.map((item, index) => {
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-button-${index}`;
        const expanded = open.has(index);
        return (
          <div key={item.q} className={styles.faqItem}>
            <h3 className={styles.faqHeading}>
              <button
                type="button"
                id={buttonId}
                className={styles.faqButton}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(index)}
              >
                <span>{item.q}</span>
                <span aria-hidden="true" className={styles.faqMark}>
                  {expanded ? '−' : '+'}
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={expanded ? undefined : true}
              className={styles.faqPanel}
            >
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
