import type { ToolRun } from '../lib/chat-state';

/**
 * What the agent actually did, in the user's language.
 *
 * Shown because the alternative is fifteen silent seconds while a search runs
 * against four store APIs. The MCP tool name is kept in the title attribute —
 * the demo is about an MCP server, and hiding its vocabulary entirely would
 * be hiding the point.
 */
const LABELS: Record<string, string> = {
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

export function ToolTrail({ tools }: { tools: ToolRun[] }) {
  if (tools.length === 0) return null;
  return (
    <ul className="trail">
      {tools.map((t) => (
        <li key={t.id} className={t.ok === false ? 'trail-item is-bad' : 'trail-item'} title={t.name}>
          <span className="trail-dot" aria-hidden="true">
            {t.ok === undefined ? '◌' : t.ok ? '●' : '×'}
          </span>
          <span>{LABELS[t.name] ?? t.name}</span>
          {t.ms !== undefined ? <span className="trail-ms">{(t.ms / 1000).toFixed(1)}s</span> : null}
        </li>
      ))}
    </ul>
  );
}
