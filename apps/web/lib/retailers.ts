/**
 * How a store's name is spelled for a person.
 *
 * The id is a lowercase slug because it is a key in the MCP server's config.
 * "Abrir en dia" is not how the store is written.
 */
export const RETAILER_NAMES: Readonly<Record<string, string>> = {
  dia: 'Día',
  carrefour: 'Carrefour',
  jumbo: 'Jumbo',
  disco: 'Disco',
};
