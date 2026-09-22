/**
 * JSON-LD in the body. Search and answer engines accept it anywhere in the page.
 * `<` is escaped so a future string cannot close the script tag.
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
