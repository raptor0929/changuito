/**
 * What each tool is doing, in the user's language. Shared by the tool trail
 * and the waiting line under the composer, so the two never disagree about
 * what the same call is called.
 */
export const TOOL_LABELS: Record<string, string> = {
  set_location: 'Ubicando la sucursal',
  search_products: 'Buscando productos',
  price_check: 'Verificando precios',
  add_to_cart: 'Agregando al carrito',
  update_cart_line: 'Ajustando cantidades',
  remove_from_cart: 'Sacando del carrito',
  view_cart: 'Revisando el carrito',
  get_cart_link: 'Armando el link del carrito',
  list_retailers: 'Mirando qué supermercados hay',
  compare_retailers: 'Comparando supermercados',
  render_products: 'Mostrando productos',
  render_cart: 'Mostrando el carrito',
};
