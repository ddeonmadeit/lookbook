import { afterEach, describe, expect, it } from "vitest";
import {
  type Availability,
  type Tier,
  NYE_MIDNIGHT,
  NYE_TIERS,
  countdownParts,
  dollars,
  isTicketOrder,
  maxQuantity,
  quote,
  quoteBreakdown,
  saleState,
  saveTicket,
  savedTickets,
  ticketCount,
  ticketRef,
  tierLine,
  tierState,
} from "@/lib/nye";

const tiers = (first: number, second = 50): Tier[] => [
  { ...NYE_TIERS[0], remaining: first, sold: 50 - first },
  { ...NYE_TIERS[1], remaining: second, sold: 50 - second },
];

const avail = (over: Partial<Availability> = {}): Availability => ({
  price: 20,
  current: "first",
  tiers: tiers(50),
  currency: "AUD",
  capacity: 100,
  max_per_order: 10,
  sold: 0,
  held: 0,
  remaining: 100,
  on_sale: true,
  ...over,
});

describe("the NYE countdown", () => {
  it("ends at midnight on New Year's Eve, Sydney time", () => {
    expect(new Date(NYE_MIDNIGHT).toISOString()).toBe("2026-12-31T13:00:00.000Z");
  });
  it("splits the time left into days, hours, minutes and seconds", () => {
    expect(countdownParts(((2 * 24 + 3) * 60 + 4) * 60_000 + 5_000)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
    expect(countdownParts(-1000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("selling tickets", () => {
  const before = NYE_MIDNIGHT - 1000;
  it("is on sale while there are tickets and it's before midnight", () => {
    expect(saleState(avail(), false, before)).toBe("on-sale");
    expect(saleState(avail({ remaining: 0, sold: 100 }), false, before)).toBe("sold-out");
    expect(saleState(avail({ on_sale: false }), false, before)).toBe("closed");
    expect(saleState(avail(), false, NYE_MIDNIGHT)).toBe("closed");
  });
  it("waits for the server, and says so if it can't be reached", () => {
    expect(saleState(null, false, before)).toBe("loading");
    expect(saleState(null, true, before)).toBe("unavailable");
  });
  it("never lets one order take more than what's left or the per-order limit", () => {
    expect(maxQuantity(avail())).toBe(10);
    expect(maxQuantity(avail({ remaining: 3 }))).toBe(3);
    expect(maxQuantity(avail({ remaining: 0 }))).toBe(0);
  });
  it("starts with 50 at $20 then 50 at $30", () => {
    expect(NYE_TIERS.map((t) => [t.name, t.price, t.capacity])).toEqual([
      ["First release", 20, 50],
      ["Second release", 30, 50],
    ]);
  });
  it("prices an order from the earliest release with places, like the server", () => {
    expect(quote(2, tiers(50))).toEqual({ lines: [{ tier: "first", name: "First release", price: 20, quantity: 2 }], total: 40 });
    const split = quote(3, tiers(1));
    expect(split?.total).toBe(80);
    expect(quoteBreakdown(split!.lines)).toBe("1 × $20 + 2 × $30");
    expect(quote(2, tiers(0))?.total).toBe(60);
    expect(quote(3, tiers(0, 2))).toBeNull();
  });
  it("labels each release: on sale, next up, or sold out", () => {
    const t = tiers(7);
    expect(tierState(t[0], { current: "first" }, t)).toBe("on-sale");
    expect(tierState(t[1], { current: "first" }, t)).toBe("next");
    expect(tierLine(t[0], "on-sale")).toBe("Only 7 left");
    expect(tierLine(tiers(40)[0], "on-sale")).toBe("On sale now");
    expect(tierLine(t[1], "next", t[0])).toBe("Opens when first release sells out");
    const gone = tiers(0);
    expect(tierState(gone[0], { current: "second" }, gone)).toBe("sold-out");
    expect(tierLine(gone[0], "sold-out")).toBe("Sold out");
    expect(tierLine({ ...gone[0], held: 2 }, "sold-out")).toMatch(/may free up/);
    expect(tierState(gone[1], null, gone)).toBe("on-sale");
  });
  it("formats prices", () => {
    expect(dollars(30)).toBe("$30");
    expect(dollars(90)).toBe("$90");
    expect(dollars(30.5)).toBe("$30.50");
  });
});

describe("ticket orders", () => {
  it("are told apart from store orders", () => {
    expect(isTicketOrder({ items: [{ kind: "ticket", quantity: 2 }] })).toBe(true);
    expect(isTicketOrder({ items: [{ title: "Hoodie", quantity: 1 }] })).toBe(false);
    expect(isTicketOrder({ items: null })).toBe(false);
  });
  it("count admissions and carry the same reference as the email", () => {
    expect(ticketCount({ items: [{ quantity: 3 }] })).toBe(3);
    expect(ticketRef("3f9a12c4-1111-2222-3333-444455556666")).toBe("KN-3F9A12C4");
  });
});

describe("tickets kept on this device", () => {
  afterEach(() => localStorage.clear());
  const t = { ref: "KN-1", name: "Sam", email: null, quantity: 2, total: 60, currency: "AUD" };
  it("keeps the newest first and never twice", () => {
    saveTicket(t);
    saveTicket({ ...t, ref: "KN-2" });
    const list = saveTicket({ ...t, quantity: 3 });
    expect(list.map((x) => [x.ref, x.quantity])).toEqual([
      ["KN-1", 3],
      ["KN-2", 2],
    ]);
    expect(savedTickets()).toEqual(list);
  });
  it("ignores anything unreadable", () => {
    localStorage.setItem("knots-nye-tickets", "{not json");
    expect(savedTickets()).toEqual([]);
  });
});
