// The unlisted /nye ticket page: event details shown on the page, and the
// small pure helpers it runs on. Prices and what's on sale always come from
// the nye-tickets edge function — the releases here are only for display
// before it answers. The page is never told how many tickets there are or
// how many are left.

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
};

export type TierState = "on-sale" | "sold-out" | "next";

export interface Tier {
  id: string;
  name: string;
  price: number;
  status: TierState;
}

/** The releases as shown before the server answers. */
export const NYE_TIERS: Tier[] = [
  { id: "first", name: "First release", price: 15, status: "on-sale" },
  { id: "second", name: "Second release", price: 20, status: "next" },
  { id: "final", name: "Final release", price: 30, status: "next" },
];

/** The version of the nye-tickets function this page is built for. */
export const NYE_VERSION = 3;

/** A release as the server reports it. Older versions sent counts instead of a status. */
interface ServerTier {
  id: string;
  name: string;
  price: number;
  status?: TierState;
  remaining?: number;
}

export interface Availability {
  /** Missing from versions before 3. */
  version?: number;
  /** The price of the next ticket. */
  price: number;
  /** The release on sale now, or null when every release is gone. */
  current?: string | null;
  sold_out?: boolean;
  currency: string;
  max_per_order: number;
  /** Missing from the first, single-price version. */
  tiers?: ServerTier[];
  /** Only from the first, single-price version. */
  remaining?: number;
  on_sale: boolean;
}

/** Whether the deployed function is older than this page: other prices, or counts it shouldn't share. */
export const isOutdated = (a: Availability | null) => Boolean(a && a.version !== NYE_VERSION);

/**
 * The releases to show and price by, from whichever version is deployed — so
 * the page never shows a price the server won't charge.
 */
export function tiersOf(a: Availability | null): Tier[] {
  if (!a) return NYE_TIERS;
  if (Array.isArray(a.tiers)) {
    const has = (t: ServerTier) => (t.remaining ?? 1) > 0;
    const current = a.current !== undefined ? a.current : a.tiers.find(has)?.id;
    return a.tiers.map((t) => ({
      id: t.id,
      name: t.name,
      price: t.price,
      status: t.status ?? (!has(t) ? "sold-out" : t.id === current ? "on-sale" : "next"),
    }));
  }
  // The first version: one price for every ticket.
  return [{ id: "entry", name: "Entry", price: a.price, status: (a.remaining ?? 1) > 0 ? "on-sale" : "sold-out" }];
}

/**
 * The price per ticket right now. An order big enough to run into the next
 * release is split between them; the server says exactly how before payment.
 */
export const currentPrice = (tiers: Tier[]) => (tiers.find((t) => t.status === "on-sale") ?? tiers[tiers.length - 1]).price;

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

/** A line of what the server held and is charging for. */
export interface QuoteLine {
  tier: string;
  name: string;
  price: number;
  quantity: number;
}

/** "2 × First release + 1 × Second release" */
export const linesLabel = (lines: QuoteLine[]) => lines.map((l) => `${l.quantity} × ${l.name}`).join(" + ");

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

/** The most one order can ask for. Not capped by what's left: that would give the number away. */
export const maxQuantity = (a: Pick<Availability, "max_per_order"> | null) => a?.max_per_order ?? 10;

export type SaleState = "loading" | "unavailable" | "on-sale" | "sold-out" | "closed";

export function saleState(a: Availability | null, failed: boolean, now: number): SaleState {
  if (now >= NYE_MIDNIGHT) return "closed";
  if (!a) return failed ? "unavailable" : "loading";
  if (!a.on_sale) return "closed";
  return tiersOf(a).some((t) => t.status === "on-sale") ? "on-sale" : "sold-out";
}

/** The line under a release's name. Never a count. */
export function tierLine(tier: Tier, previous?: Tier) {
  if (tier.status === "sold-out") return "Sold out";
  if (tier.status === "next") return previous ? `Opens when ${previous.name.toLowerCase()} sells out` : "Coming soon";
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
