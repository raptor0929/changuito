import type { Metadata } from 'next';

import { ProductHome } from '../../components/product-home';

export const metadata: Metadata = {
  title: { absolute: 'changuito' },
  description:
    'An agent that shops Argentine supermarkets and settles the basket in USDC on Stellar.',
  robots: { index: false, follow: false },
};

export default function AgentPage() {
  return <ProductHome />;
}
