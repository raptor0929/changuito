import type { MetadataRoute } from 'next';

import { LEGAL_PATHS } from '../lib/legal';
import { canonicalUrl, sitemapEntries } from '../lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const legal = Object.values(LEGAL_PATHS).flatMap((paths) => Object.values(paths));
  return [
    ...sitemapEntries(),
    ...legal.map((path) => ({
      url: canonicalUrl(path),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];
}
