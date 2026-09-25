'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Cart } from '@changuito/mcp/types';

/**
 * What the two rails know, and what the chat publishes into them.
 *
 * The chat owns the conversation; it always has. But the cart panel on the
 * right and the history list on the left are siblings of the chat in the
 * layout, not children, so the state they read has to live above all three.
 * This is that, and nothing else — no fetching, no persistence. Phase two
 * gives it a localStorage backing; keeping the seam here means that change
 * touches one file instead of three.
 *
 * One chat is one order. The rule is enforced where the user would break it
 * (the composer, and the deposit route), not here — this only records which
 * chat is open and what state its order is in, so the list can say so.
 */

export type OrderState = 'none' | 'open' | 'paid';

export interface ChatSummary {
  id: string;
  /** The shopper's first message, trimmed. Falls back to a date. */
  title: string;
  createdAt: number;
  orderState: OrderState;
}

interface ShopValue {
  chats: ChatSummary[];
  activeChatId: string | null;
  /** The basket as the store last reported it, or null before there is one. */
  cart: Cart | null;
  handoffUrl: string | null;
  orderState: OrderState;
  publishCart: (cart: Cart | null, handoffUrl?: string) => void;
  openChat: (id: string) => void;
  newChat: () => void;
  /**
   * Whether the history drawer is open. Only meaningful below the wide
   * breakpoint, where the rail is off-canvas; above it the rail is a column
   * and this is ignored. It lives here rather than in Deck because the
   * control that sets it sits in the masthead, inside the chat shell, and
   * the rail it opens is the shell's sibling — so the two have no common
   * ancestor below this one.
   */
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
}

const ShopContext = createContext<ShopValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const publishCart = useCallback((next: Cart | null, url?: string) => {
    setCart(next);
    // An absent url does not erase one we already have. The agent renders the
    // cart before it has the link and again after, and the second render is
    // the one that carries it — dropping it on the first would blank the
    // button between the two. chat-state.ts holds the same rule for blocks.
    setHandoffUrl((prev) => url ?? prev);
  }, []);

  const openChat = useCallback((id: string) => setActiveChatId(id), []);
  const newChat = useCallback(() => {
    setActiveChatId(null);
    setCart(null);
    setHandoffUrl(null);
  }, []);

  const orderState = useMemo<OrderState>(
    () => chats.find((c) => c.id === activeChatId)?.orderState ?? 'none',
    [chats, activeChatId],
  );

  const value = useMemo<ShopValue>(
    () => ({
      chats, activeChatId, cart, handoffUrl, orderState,
      publishCart, openChat, newChat, historyOpen, setHistoryOpen,
    }),
    [chats, activeChatId, cart, handoffUrl, orderState, publishCart, openChat, newChat, historyOpen],
  );

  // setChats is unused until phase two adds persistence. Referencing it here
  // rather than dropping it keeps the shape of the provider honest about what
  // it will hold.
  void setChats;

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

/**
 * Null outside the provider rather than a throw: the rails and the chat are
 * both rendered in tests and in app/dev/ui without one, and a hook that
 * explodes there would make the fixtures page harder to keep than the
 * component it is fixturing.
 */
export function useShop(): ShopValue | null {
  return useContext(ShopContext);
}
