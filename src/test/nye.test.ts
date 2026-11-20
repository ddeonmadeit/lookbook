import { afterEach, describe, expect, it } from "vitest";
import {
  type Availability,
  NYE_MIDNIGHT,
  availabilityLine,
  countdownParts,
  dollars,
  isTicketOrder,
  maxQuantity,
  saleState,
  saveTicket,
  savedTickets,
  ticketCount,
  ticketRef,
} from "@/lib/nye";

const avail = (over: Partial<Availability> = {}): Availability => ({
  price: 30,
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
  it("shows the cap until stock is low, then how many are left", () => {
    expect(availabilityLine(null)).toBe("Strictly 100 tickets");
    expect(availabilityLine(avail({ remaining: 60 }))).toBe("Strictly 100 tickets");
    expect(availabilityLine(avail({ remaining: 7 }))).toBe("Only 7 left");
    expect(availabilityLine(avail({ remaining: 0 }))).toBe("Sold out");
    expect(availabilityLine(avail({ remaining: 0, held: 2 }))).toMatch(/may free up/);
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
