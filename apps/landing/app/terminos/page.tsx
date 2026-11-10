import { LegalPage, legalMetadata } from '../../components/legal/legal-page';

export const dynamic = 'force-static';

export const metadata = legalMetadata('terms', 'es');

export default function TerminosPage() {
  return <LegalPage doc="terms" lang="es" />;
}
