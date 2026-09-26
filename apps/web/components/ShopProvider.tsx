'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Cart } from '@changuito/mcp/types';

import type { ChatState } from '../lib/chat-state.ts';
import {
  deleteChat,
  isResumable,
  listChats,
  loadChat,
  saveChat,
  type ChatSummary,
  type OrderState,
  type Receipt,
  type StoredChat,
} from '../lib/chat-store.ts';

/**
 * What the two rails know, what the chat publishes into them, and where a
 * conversation goes when the tab closes.
 *
 * The chat owns the conversation; it always has. But the cart panel on the
 * right and the history list on the left are siblings of the chat in the
 * layout, not children, so the state they read has to live above all three.
 *
 * ## One chat is one order
 *
 * Enforced in two places for two different reasons. Here, so the composer can
 * refuse before the shopper types a second basket into a chat whose order is
 * already placed — `canOrder` is that question. And again at the deposit
 * route, because a browser is not where a rule about money gets to live.
 *
 * ## Restoring
 *
 * A chat comes back only if the store says it is still resumable: open, and
 * younger than the agent's one hour history TTL. Anything else opens as a
 * receipt the shopper can read but not continue. The decision is the store's
 * (`isResumable`), the consequence is here: a non-resumable chat is handed to
 * the chat component with `sessionId: null`, which is what makes the composer
 * go away.
 */

export type { OrderState, Receipt };
export type { ChatSummary };

/**
 * What the provider is asking the chat component to do, picked up by an
 * effect there and acknowledged. A request rather than a call because the
 * transcript lives in `useChat`, below this, and React state does not flow
 * upward.
 */
export type ChatRequest = { kind: 'new'; token: number } | { kind: 'open'; token: number; chat: StoredChat };

export interface PublishInput {
  state: Pick<ChatState, 'blocks' | 'snapshot' | 'cart'>;
  sessionId: string | null;
}

interface ShopValue {
  chats: ChatSummary[];
  activeChatId: string | null;
  /** The basket as the store last reported it, or null before there is one. */
  cart: Cart | null;
  handoffUrl: string | null;
  orderState: OrderState;
  /** The order this chat already placed, once it is paid. */
  receipt: Receipt | null;
  /** False once this chat's order is placed. The composer reads it. */
  canOrder: boolean;
  /** True when the open chat is a record: paid, or older than the agent remembers. */
  readOnly: boolean;
  /** Everything the chat knows, on every change. Saved, debounced by React's own batching. */
  publish: (input: PublishInput) => void;
  openChat: (id: string) => void;
  newChat: () => void;
  forgetChat: (id: string) => void;
  /** Mark the open chat paid and file its receipt. Phase four calls this. */
  settle: (receipt: Receipt) => void;
  request: ChatRequest | null;
  ack: () => void;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
}

const ShopContext = createContext<ShopValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<number>(() => Date.now());
  const [cart, setCart] = useState<Cart | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [orderState, setOrderState] = useState<OrderState>('none');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [request, setRequest] = useState<ChatRequest | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // After hydration, never during render: reading storage while rendering
  // makes the server's HTML and the browser's first paint disagree, and React
  // throws the whole tree away to fix it. NetworkProvider.tsx does the same.
  useEffect(() => {
    setChats(listChats());
  }, []);

  const publish = useCallback(
    ({ state, sessionId }: PublishInput) => {
      // Nothing is written while a switch is in flight.
      //
      // `newChat()` clears this provider's idea of the order — id, state,
      // receipt — in one commit, and the chat component only swaps its
      // transcript an effect later. In between, the transcript on screen is
      // the old chat's and the metadata beside it is the new chat's, and
      // `activeChatId` is already null so the id would fall through to the
      // agent's session id: the record of the chat that was just paid,
      // rewritten as unpaid with no receipt. Found by
      // e2e/app-frame-checkout.spec.ts, which starts a new chat and then goes
      // back to look at the old one.
      //
      // Skipping is safe because the swap ends in `ack()`, which changes this
      // callback's identity and makes the chat publish again — with both
      // halves from the same chat.
      if (request) return;

      const next = state.cart?.cart ?? null;
      setCart(next);
      // An absent url does not erase one we already have. The agent renders the
      // cart before it has the link and again after, and the second render is
      // the one that carries it — dropping it on the first would blank the
      // button between the two. chat-state.ts holds the same rule for blocks.
      setHandoffUrl((prev) => state.cart?.handoffUrl ?? prev);

      // A chat with nothing in it is not a chat yet; saveChat says so too.
      if (state.blocks.length === 0) return;
      // The id of a conversation is the id the agent gave it, so the record
      // and the server's history are filed under the same name.
      const id = activeChatId ?? sessionId;
      if (!id) return;
      const saved = saveChat({ id, createdAt, sessionId, state, orderState, receipt });
      if (!saved) return;
      if (activeChatId !== id) setActiveChatId(id);
      setChats(listChats());
    },
    [request, activeChatId, createdAt, orderState, receipt],
  );

  const newChat = useCallback(() => {
    setActiveChatId(null);
    setCreatedAt(Date.now());
    setCart(null);
    setHandoffUrl(null);
    setOrderState('none');
    setReceipt(null);
    setReadOnly(false);
    setHistoryOpen(false);
    setRequest({ kind: 'new', token: Date.now() });
  }, []);

  const openChat = useCallback((id: string) => {
    const chat = loadChat(id);
    if (!chat) {
      // The index knew about it and the record is gone — a hand-edited
      // storage, or a write that failed after the index one succeeded. Drop
      // the row rather than leaving a button that does nothing.
      deleteChat(id);
      setChats(listChats());
      return;
    }
    const live = isResumable(chat);
    setActiveChatId(chat.id);
    setCreatedAt(chat.createdAt);
    setCart(chat.cart);
    setHandoffUrl(chat.handoffUrl);
    setOrderState(chat.orderState);
    setReceipt(chat.receipt);
    setReadOnly(!live);
    setHistoryOpen(false);
    // `sessionId: null` when it is not resumable, so the chat component cannot
    // accidentally send into a session the server has forgotten. The store
    // decides; this only carries the decision.
    setRequest({ kind: 'open', token: Date.now(), chat: live ? chat : { ...chat, sessionId: null } });
  }, []);

  const forgetChat = useCallback(
    (id: string) => {
      deleteChat(id);
      setChats(listChats());
      if (id === activeChatId) newChat();
    },
    [activeChatId, newChat],
  );

  const settle = useCallback((paid: Receipt) => {
    setOrderState('paid');
    setReceipt(paid);
    setReadOnly(true);
  }, []);

  const ack = useCallback(() => setRequest(null), []);

  const value = useMemo<ShopValue>(
    () => ({
      chats,
      activeChatId,
      cart,
      handoffUrl,
      orderState,
      receipt,
      canOrder: orderState !== 'paid' && !readOnly,
      readOnly,
      publish,
      openChat,
      newChat,
      forgetChat,
      settle,
      request,
      ack,
      historyOpen,
      setHistoryOpen,
    }),
    [
      chats, activeChatId, cart, handoffUrl, orderState, receipt, readOnly,
      publish, openChat, newChat, forgetChat, settle, request, ack, historyOpen,
    ],
  );

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
