// The unlisted /nye ticket page: event details shown on the page, and the
// small pure helpers it runs on. Price, cap and what's left always come from
// the nye-tickets edge function — the numbers here are only for display
// before it answers.

/** Midnight on New Year's Eve in Sydney (AEDT, UTC+11), i.e. 2026-12-31T13:00:00Z. */
export const NYE_MIDNIGHT = Date.parse("2027-01-01T00:00:00+11:00");

export const NYE_EVENT = {
  title: "New Year's Eve",
  kind: "Rooftop party",
  date: "31.12.2026",
  dateLong: "Thursday 31 December 2026",
  time: "6pm – 1am",
  venue: "175 Cathedral St, Woolloomooloo",
  suburb: "Woolloomooloo",
  capacity: 100,
};

export interface Tier {
  id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  held: number;
  remaining: number;
}

/** The releases as they stand before the server answers: all unsold. */
export const NYE_TIERS: Tier[] = [
  { id: "first", name: "First release", price: 20, capacity: 50, sold: 0, held: 0, remaining: 50 },
  { id: "second", name: "Second release", price: 30, capacity: 50, sold: 0, held: 0, remaining: 50 },
];

/** A release shows how many are left once it's down to this many. */
export const LOW_STOCK = 20;

export interface Availability {
  /** The price of the next ticket. */
  price: number;
  /** The release on sale now, or null when every release is gone. */
  current: string | null;
  currency: string;
  capacity: number;
  max_per_order: number;
  sold: number;
  held: number;
  remaining: number;
  tiers: Tier[];
  on_sale: boolean;
}

export interface NyeTicket {
  ref: string;
  name: string | null;
  email: string | null;
  quantity: number;
  /** "2 × First release" — older saved tickets don't have it. */
  releases?: string;
  total: number;
  currency: string;
}

export interface QuoteLine {
  tier: string;
  name: string;
  price: number;
  quantity: number;
}

/**
 * What `quantity` tickets cost right now: filled from the earliest release
 * with places left, the same way the server charges. Null if they don't fit.
 */
export function quote(quantity: number, tiers: Tier[]): { lines: QuoteLine[]; total: number } | null {
  const lines: QuoteLine[] = [];
  let left = quantity;
  for (const t of tiers) {
    const take = Math.min(left, Math.max(0, t.remaining));
    if (take > 0) lines.push({ tier: t.id, name: t.name, price: t.price, quantity: take });
    left -= take;
  }
  if (left > 0) return null;
  return { lines, total: lines.reduce((n, l) => n + l.price * l.quantity, 0) };
}

/** "1 × $20 + 2 × $30" */
export const quoteBreakdown = (lines: QuoteLine[]) => lines.map((l) => `${l.quantity} × ${dollars(l.price)}`).join(" + ");

export type TierState = "on-sale" | "sold-out" | "next";

/** Sold out, on sale now, or waiting for an earlier release to go. */
export function tierState(tier: Tier, a: Pick<Availability, "current"> | null, tiers: Tier[]): TierState {
  if (tier.remaining <= 0) return "sold-out";
  const current = a ? a.current : tiers.find((t) => t.remaining > 0)?.id;
  return tier.id === current ? "on-sale" : "next";
}

export function countdownParts(ms: number) {
  const diff = Math.max(0, ms);
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1000),
  };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** "$30" for whole dollars, "$30.50" otherwise. */
export function dollars(amount: number) {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** The most one order can take right now. */
export function maxQuantity(a: Pick<Availability, "max_per_order" | "remaining"> | null) {
  if (!a) return 10;
  return Math.max(0, Math.min(a.max_per_order, a.remaining));
}

export type SaleState = "loading" | "unavailable" | "on-sale" | "sold-out" | "closed";

export function saleState(a: Availability | null, failed: boolean, now: number): SaleState {
  if (now >= NYE_MIDNIGHT) return "closed";
  if (!a) return failed ? "unavailable" : "loading";
  if (!a.on_sale) return "closed";
  return a.remaining > 0 ? "on-sale" : "sold-out";
}

/** The line under a release's name. */
export function tierLine(tier: Tier, state: TierState, previous?: Tier) {
  if (state === "sold-out") return tier.held > 0 ? "Sold out — held places may free up" : "Sold out";
  if (state === "next") return previous ? `Opens when ${previous.name.toLowerCase()} sells out` : "Coming soon";
  if (tier.remaining <= LOW_STOCK) return `Only ${tier.remaining} left`;
  return "On sale now";
}

// Tickets bought on this device, so coming back to /nye shows them again.
const STORE_KEY = "knots-nye-tickets";

export function savedTickets(): NyeTicket[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as NyeTicket[]) : [];
    return Array.isArray(list) ? list.filter((t) => t && typeof t.ref === "string") : [];
  } catch {
    return [];
  }
}

export function saveTicket(ticket: NyeTicket): NyeTicket[] {
  const list = [ticket, ...savedTickets().filter((t) => t.ref !== ticket.ref)];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // private browsing: the ticket still shows now, and is emailed
  }
  return list;
}

/** PostgREST filter value matching ticket orders (as a JSON string — see supabase-js `contains`). */
export const TICKET_ITEMS = JSON.stringify([{ kind: "ticket" }]);

export const isTicketOrder = (o: { items?: ReadonlyArray<object | null> | null }) =>
  Boolean(o.items?.some((it) => (it as { kind?: unknown } | null)?.kind === "ticket"));

/** "KN-3F9A12C4", the reference printed on the ticket (same as store orders). */
export const ticketRef = (orderId: string) => `KN-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

export const ticketCount = (o: { items?: Array<{ quantity?: number } | null> | null }) =>
  (o.items ?? []).reduce((n, it) => n + (Number(it?.quantity) || 0), 0);
