import { LegalPage, legalMetadata } from '../../components/legal/legal-page';

export const dynamic = 'force-static';

export const metadata = legalMetadata('privacy', 'en');

export default function PrivacyPage() {
  return <LegalPage doc="privacy" lang="en" />;
}
