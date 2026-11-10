import { LegalPage, legalMetadata } from '../../components/legal/legal-page';

export const dynamic = 'force-static';

export const metadata = legalMetadata('deletion', 'es');

export default function EliminarCuentaPage() {
  return <LegalPage doc="deletion" lang="es" />;
}
