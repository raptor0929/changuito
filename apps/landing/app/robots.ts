import type { MetadataRoute } from 'next';

import { robotsConfig } from '../lib/seo';

/**
 * Marketing site (www.changuito.me): index the public pages.
 * The shopper at app.changuito.me disallows crawlers in apps/web.
 * Do not copy that policy here. `/api/` is not a page.
 */
export default function robots(): MetadataRoute.Robots {
  return robotsConfig();
}
