import type { ToolRun } from '../lib/chat-state';

/**
 * What the agent actually did, in the user's language.
 *
 * Shown because the alternative is fifteen silent seconds while a search runs
 * against four store APIs. Raw tool ids stay in the title attribute for debug.
 *
 * The back-and-forth cart GIF sits on the last trail row only, so the eye
 * always finds the step that is still moving.
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

  const lastIdx = tools.length - 1;
  const anyPending = tools.some((t) => t.ok === undefined);

  return (
    <ul className="trail">
      {tools.map((t, i) => {
        const isLast = i === lastIdx;
        const showCart = isLast && anyPending;
        return (
          <li
            key={t.id}
            className={t.ok === false ? 'trail-item is-bad' : 'trail-item'}
            title={t.name}
          >
            {showCart ? (
              <img
                className="trail-cart"
                src="/brand/animacion-busqueda.gif"
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
              />
            ) : (
              <span className="trail-dot" aria-hidden="true">
                {t.ok === undefined ? '◌' : t.ok ? '●' : '×'}
              </span>
            )}
            <span>{LABELS[t.name] ?? t.name}</span>
            {t.ms !== undefined ? (
              <span className="trail-ms">{(t.ms / 1000).toFixed(1)}s</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
