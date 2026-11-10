import { LegalPage, legalMetadata } from '../../components/legal/legal-page';

export const dynamic = 'force-static';

export const metadata = legalMetadata('privacy', 'es');

export default function PrivacidadPage() {
  return <LegalPage doc="privacy" lang="es" />;
}
