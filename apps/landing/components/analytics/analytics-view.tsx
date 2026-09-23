'use client';

import { useEffect } from 'react';

import { track, type AnalyticsEvent } from '../../lib/analytics.ts';

export function AnalyticsView({
  event,
}: {
  event: Extract<AnalyticsEvent, 'whitelist_view' | 'whitelist_submit_success' | 'bug_report_view' | 'bug_report_success'>;
}) {
  useEffect(() => {
    track(event);
  }, [event]);

  return null;
}
