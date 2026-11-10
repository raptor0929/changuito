import { LegalPage, legalMetadata } from '../../components/legal/legal-page';

export const dynamic = 'force-static';

export const metadata = legalMetadata('deletion', 'en');

export default function DeleteAccountPage() {
  return <LegalPage doc="deletion" lang="en" />;
}
