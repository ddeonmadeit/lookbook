import { afterEach, describe, expect, it } from "vitest";
import {
  type Availability,
  NYE_MIDNIGHT,
  NYE_TIERS,
  NYE_VERSION,
  countdownParts,
  currentPrice,
  dollars,
  isOutdated,
  isTicketOrder,
  linesLabel,
  maxQuantity,
  saleState,
  saveTicket,
  savedTickets,
  ticketCount,
  ticketRef,
  tierLine,
  tiersOf,
} from "@/lib/nye";

type Status = "on-sale" | "sold-out" | "next";
const avail = (statuses: [Status, Status, Status] = ["on-sale", "next", "next"], over: Partial<Availability> = {}): Availability => ({
  version: NYE_VERSION,
  price: 15,
  current: "first",
  sold_out: false,
  currency: "AUD",
  max_per_order: 10,
  tiers: NYE_TIERS.map((t, i) => ({ id: t.id, name: t.name, price: t.price, status: statuses[i] })),
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

describe("the releases", () => {
  it("are first $15, second $20, final $30", () => {
    expect(NYE_TIERS.map((t) => [t.name, t.price])).toEqual([
      ["First release", 15],
      ["Second release", 20],
      ["Final release", 30],
    ]);
  });
  it("never carry or show a count", () => {
    for (const t of tiersOf(avail())) expect(Object.keys(t).sort()).toEqual(["id", "name", "price", "status"]);
    const lines = tiersOf(avail(["sold-out", "on-sale", "next"])).map((t, i, all) => tierLine(t, all[i - 1]));
    expect(lines).toEqual(["Sold out", "On sale now", "Opens when second release sells out"]);
    for (const line of lines) expect(line).not.toMatch(/\d/);
  });
  it("price tickets at the release on sale", () => {
    expect(currentPrice(tiersOf(avail()))).toBe(15);
    expect(currentPrice(tiersOf(avail(["sold-out", "on-sale", "next"])))).toBe(20);
    expect(currentPrice(tiersOf(avail(["sold-out", "sold-out", "on-sale"])))).toBe(30);
  });
  it("describe what the server held", () => {
    expect(
      linesLabel([
        { tier: "first", name: "First release", price: 15, quantity: 1 },
        { tier: "second", name: "Second release", price: 20, quantity: 2 },
      ]),
    ).toBe("1 × First release + 2 × Second release");
  });
});

describe("selling tickets", () => {
  const before = NYE_MIDNIGHT - 1000;
  it("is on sale while any release is, and before midnight", () => {
    expect(saleState(avail(), false, before)).toBe("on-sale");
    expect(saleState(avail(["sold-out", "sold-out", "on-sale"]), false, before)).toBe("on-sale");
    expect(saleState(avail(["sold-out", "sold-out", "sold-out"], { current: null, sold_out: true }), false, before)).toBe("sold-out");
    expect(saleState(avail(undefined, { on_sale: false }), false, before)).toBe("closed");
    expect(saleState(avail(), false, NYE_MIDNIGHT)).toBe("closed");
  });
  it("waits for the server, and says so if it can't be reached", () => {
    expect(saleState(null, false, before)).toBe("loading");
    expect(saleState(null, true, before)).toBe("unavailable");
  });
  it("lets any order ask for up to the per-order limit, whatever's left", () => {
    expect(maxQuantity(avail())).toBe(10);
    expect(maxQuantity(null)).toBe(10);
  });
  it("formats prices", () => {
    expect(dollars(15)).toBe("$15");
    expect(dollars(30.5)).toBe("$30.50");
  });
});

describe("older versions of the function", () => {
  it("the first, single-price one: shows its one price", () => {
    const old: Availability = { price: 30, currency: "AUD", max_per_order: 10, remaining: 100, on_sale: true };
    expect(isOutdated(old)).toBe(true);
    expect(tiersOf(old)).toEqual([{ id: "entry", name: "Entry", price: 30, status: "on-sale" }]);
    expect(tiersOf({ ...old, remaining: 0 })[0].status).toBe("sold-out");
  });
  it("the two-release one: works out each release's status from its counts", () => {
    const v2: Availability = {
      price: 30,
      current: "second",
      currency: "AUD",
      max_per_order: 10,
      on_sale: true,
      tiers: [
        { id: "first", name: "First release", price: 20, remaining: 0 },
        { id: "second", name: "Second release", price: 30, remaining: 12 },
      ],
    };
    expect(isOutdated(v2)).toBe(true);
    expect(tiersOf(v2).map((t) => [t.id, t.price, t.status])).toEqual([
      ["first", 20, "sold-out"],
      ["second", 30, "on-sale"],
    ]);
    expect(isOutdated(avail())).toBe(false);
  });
});

describe("ticket orders", () => {
  it("are told apart from store orders", () => {
    expect(isTicketOrder({ items: [{ kind: "ticket", quantity: 2 }] })).toBe(true);
    expect(isTicketOrder({ items: [{ title: "Hoodie", quantity: 1 }] })).toBe(false);
    expect(isTicketOrder({ items: null })).toBe(false);
  });
  it("count admissions and carry the same reference as the email", () => {
    expect(ticketCount({ items: [{ quantity: 1 }, { quantity: 2 }] })).toBe(3);
    expect(ticketRef("3f9a12c4-1111-2222-3333-444455556666")).toBe("KN-3F9A12C4");
  });
});

describe("tickets kept on this device", () => {
  afterEach(() => localStorage.clear());
  const t = { ref: "KN-1", name: "Sam", email: null, quantity: 2, total: 30, currency: "AUD" };
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
