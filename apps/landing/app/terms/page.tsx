import { LegalPage, legalMetadata } from '../../components/legal/legal-page';

export const dynamic = 'force-static';

export const metadata = legalMetadata('terms', 'en');

export default function TermsPage() {
  return <LegalPage doc="terms" lang="en" />;
}
