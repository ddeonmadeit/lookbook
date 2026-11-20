// The unlisted /nye ticket page: event details shown on the page, and the
// small pure helpers it runs on. Price, cap and what's left always come from
// the nye-tickets edge function — the numbers here are only for display
// before it answers.

/** Midnight on New Year's Eve in Sydney (AEDT, UTC+11), i.e. 2026-12-31T13:00:00Z. */
export const NYE_MIDNIGHT = Date.parse("2027-01-01T00:00:00+11:00");

export const NYE_EVENT = {
  title: "New Year's Eve",
  date: "31.12.2026",
  dateLong: "Thursday 31 December 2026",
  city: "Sydney",
  price: 30,
  capacity: 100,
  /**
   * The flyer image, once it's ready: drop the file in src/assets/nye/ and
   * import it here. Until then the page shows a black placeholder.
   */
  flyer: null as string | null,
};

/** Shown to everyone once they're under this many tickets. */
export const LOW_STOCK = 25;

export interface Availability {
  price: number;
  currency: string;
  capacity: number;
  max_per_order: number;
  sold: number;
  held: number;
  remaining: number;
  on_sale: boolean;
}

export interface NyeTicket {
  ref: string;
  name: string | null;
  email: string | null;
  quantity: number;
  total: number;
  currency: string;
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

/** The line under the price: scarcity once it's real, the cap until then. */
export function availabilityLine(a: Availability | null) {
  if (!a) return `Strictly ${NYE_EVENT.capacity} tickets`;
  if (a.remaining <= 0) {
    return a.held > 0 ? "Sold out — places held for people paying may free up" : "Sold out";
  }
  if (a.remaining <= LOW_STOCK) return `Only ${a.remaining} left`;
  return `Strictly ${a.capacity} tickets`;
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
