import { z } from 'zod';

/**
 * Machine-readable shapes for the three tools a UI draws.
 *
 * The text a tool returns is written for a model to read: padded columns, an
 * "(was $4.200,00)" suffix, "$3.150,00" in AR locale. A grid that regexes that
 * back apart is brittle in the worst way — a spacing change yields a wrong
 * price rather than a missing one, and the number was an integer three calls
 * earlier. So these tools return both: unchanged text for the model, and the
 * same data structurally for the renderer.
 *
 * They mirror `types.ts` exactly. A tool must keep returning its text content
 * as well, or a plain stdio client sees an empty response.
 */

export const MoneySchema = z.object({
  centavos: z.number().int(),
  display: z.string(),
});

export const ProductSchema = z.object({
  skuId: z.string(),
  productId: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  ean: z.string().optional(),
  sellerId: z.string(),
  price: MoneySchema,
  listPrice: MoneySchema.optional(),
  available: z.boolean(),
  availableQuantity: z.number().int().optional(),
  imageUrl: z.string().optional(),
  url: z.string().optional(),
  categories: z.array(z.string()).optional(),
  unitMultiplier: z.number().optional(),
  measurementUnit: z.string().optional(),
});

export const CartLineSchema = z.object({
  index: z.number().int(),
  skuId: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  sellerId: z.string(),
  unitPrice: MoneySchema,
  lineTotal: MoneySchema,
  available: z.boolean(),
});

export const CartSchema = z.object({
  retailer: z.string(),
  cartId: z.string(),
  lines: z.array(CartLineSchema),
  total: MoneySchema,
  messages: z.array(z.string()),
});

/** search_products */
export const ProductsOutput = { products: z.array(ProductSchema) };

/** view_cart */
export const CartOutput = { cart: CartSchema };

/** get_cart_link — the cart plus where the user finishes the job. */
export const CartLinkOutput = {
  cart: CartSchema,
  handoffUrl: z.string().optional(),
};
