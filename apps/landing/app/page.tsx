import { JsonLd } from '../components/seo/json-ld';
import { LandingPage } from '../components/landing/landing-page';
import { homeJsonLd, pageMetadata, publicPage } from '../lib/seo';

export const metadata = pageMetadata(publicPage('/'));

export default function Home() {
  return (
    <>
      <JsonLd data={homeJsonLd()} />
      <LandingPage />
    </>
  );
}
