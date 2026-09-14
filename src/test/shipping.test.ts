import { describe, expect, it } from "vitest";
import {
  auZoneForPostcode,
  quoteAllServices,
  quoteShipping,
  totalWeightGrams,
  zoneForDestination,
  type RateRow,
} from "../../supabase/functions/_shared/shipping";

// Mirrors rows seeded by 20260914090000_postcode_zones_and_express.sql.
const RATES: RateRow[] = [
  { zone: "AU_SYD", max_weight_grams: 500, price: 9.7, service: "standard" },
  { zone: "AU_SYD", max_weight_grams: 1000, price: 11.2, service: "standard" },
  { zone: "AU_SYD", max_weight_grams: 2000, price: 13.4, service: "standard" },
  { zone: "AU_SYD", max_weight_grams: 500, price: 13.9, service: "express" },
  { zone: "AU_SYD", max_weight_grams: 1000, price: 16.1, service: "express" },
  { zone: "AU_NSW", max_weight_grams: 500, price: 10.95, service: "standard" },
  { zone: "AU_INTER", max_weight_grams: 500, price: 12.3, service: "standard" },
  { zone: "AU_INTER", max_weight_grams: 500, price: 17.5, service: "express" },
  { zone: "AU_REMOTE", max_weight_grams: 500, price: 14.5, service: "standard" },
  { zone: "NA_ME", max_weight_grams: 1000, price: 38.65, service: "standard" },
  { zone: "NA_ME", max_weight_grams: 1000, price: 65.7, service: "express" },
  { zone: "ROW", max_weight_grams: 2000, price: 72.45, service: "standard" },
];

const HANDLING = 8.4;

function quote(
  country: string,
  weightGrams: number,
  opts: { postcode?: string; service?: "standard" | "express"; subtotal?: number; free?: number | null } = {},
) {
  return quoteShipping({
    country,
    postcode: opts.postcode,
    weightGrams,
    subtotal: opts.subtotal ?? 100,
    rates: RATES,
    handlingFee: HANDLING,
    freeThreshold: opts.free ?? null,
    service: opts.service,
  });
}

describe("auZoneForPostcode", () => {
  it("puts Sydney metro postcodes in the Sydney band", () => {
    expect(auZoneForPostcode("2000")).toBe("AU_SYD"); // CBD
    expect(auZoneForPostcode("2026")).toBe("AU_SYD"); // Bondi
    expect(auZoneForPostcode("2170")).toBe("AU_SYD"); // Liverpool
    expect(auZoneForPostcode("2750")).toBe("AU_SYD"); // Penrith
  });

  it("puts the rest of NSW and the ACT in the regional band", () => {
    expect(auZoneForPostcode("2300")).toBe("AU_NSW"); // Newcastle
    expect(auZoneForPostcode("2650")).toBe("AU_NSW"); // Wagga
    expect(auZoneForPostcode("2600")).toBe("AU_NSW"); // Canberra
  });

  it("bands the other states correctly", () => {
    expect(auZoneForPostcode("3000")).toBe("AU_INTER"); // Melbourne
    expect(auZoneForPostcode("4000")).toBe("AU_INTER"); // Brisbane
    expect(auZoneForPostcode("5000")).toBe("AU_INTER"); // Adelaide
    expect(auZoneForPostcode("7000")).toBe("AU_INTER"); // Hobart
    expect(auZoneForPostcode("6000")).toBe("AU_REMOTE"); // Perth
    expect(auZoneForPostcode("0800")).toBe("AU_REMOTE"); // Darwin
  });

  it("falls back to the middle band for junk or missing postcodes", () => {
    expect(auZoneForPostcode("")).toBe("AU_NSW");
    expect(auZoneForPostcode(null)).toBe("AU_NSW");
    expect(auZoneForPostcode("abc")).toBe("AU_NSW");
  });
});

describe("zoneForDestination", () => {
  it("resolves Australian addresses on postcode, not country alone", () => {
    expect(zoneForDestination("AU", "2000")).toBe("AU_SYD");
    expect(zoneForDestination("AU", "6000")).toBe("AU_REMOTE");
  });

  it("resolves everywhere else on country", () => {
    expect(zoneForDestination("NZ")).toBe("NZ");
    expect(zoneForDestination("JP")).toBe("ASIA");
    expect(zoneForDestination("US")).toBe("NA_ME");
    expect(zoneForDestination("GB")).toBe("ROW");
    expect(zoneForDestination("ZZ")).toBe("ROW");
  });
});

describe("quoteShipping", () => {
  it("charges less across Sydney than across the country", () => {
    const syd = quote("AU", 400, { postcode: "2000" }).cost;
    const perth = quote("AU", 400, { postcode: "6000" }).cost;
    expect(syd).toBe(18.1); // 9.70 + 8.40
    expect(perth).toBe(22.9); // 14.50 + 8.40
    expect(syd).toBeLessThan(perth);
  });

  it("prices each domestic band from its own rates", () => {
    expect(quote("AU", 400, { postcode: "2300" }).cost).toBe(19.35); // 10.95 + 8.40
    expect(quote("AU", 400, { postcode: "3000" }).cost).toBe(20.7); // 12.30 + 8.40
  });

  it("charges more for express than standard", () => {
    const std = quote("AU", 400, { postcode: "2000", service: "standard" }).cost;
    const exp = quote("AU", 400, { postcode: "2000", service: "express" }).cost;
    expect(std).toBe(18.1);
    expect(exp).toBe(22.3); // 13.90 + 8.40
    expect(exp).toBeGreaterThan(std);
  });

  it("adds the handling fee exactly once, on top of the carrier rate", () => {
    const q = quote("US", 900);
    expect(q.carrierCost).toBe(38.65);
    expect(q.handlingFee).toBe(8.4);
    expect(q.cost).toBe(47.05);
  });

  it("labels the quote with service and destination", () => {
    expect(quote("AU", 400, { postcode: "2000", service: "express" }).label)
      .toBe("Express — Sydney metro");
    expect(quote("US", 900).label).toBe("Standard — North America & Middle East");
  });

  it("gives free standard shipping above the threshold, but never free express", () => {
    expect(quote("US", 900, { subtotal: 400, free: 300 }).free).toBe(true);
    expect(quote("US", 900, { subtotal: 400, free: 300 }).cost).toBe(0);
    const exp = quote("US", 900, { subtotal: 400, free: 300, service: "express" });
    expect(exp.free).toBe(false);
    expect(exp.cost).toBe(74.1); // 65.70 + 8.40
  });

  it("splits a parcel heavier than the largest tier into multiple parcels", () => {
    const q = quote("AU", 5000, { postcode: "2000" }); // largest here is 2kg @ 13.40
    expect(q.parcels).toBe(3);
    expect(q.carrierCost).toBe(40.2);
    expect(q.cost).toBe(48.6); // handling still charged once
  });

  it("falls back to the flat rate when a zone has no rates", () => {
    const q = quoteShipping({
      country: "GB", weightGrams: 500, subtotal: 100,
      rates: [], handlingFee: HANDLING, flatRateFallback: 20,
    });
    expect(q.cost).toBe(28.4);
  });
});

describe("quoteAllServices", () => {
  it("returns both options, cheapest first", () => {
    const options = quoteAllServices({
      country: "AU", postcode: "2000", weightGrams: 400,
      subtotal: 100, rates: RATES, handlingFee: HANDLING,
    });
    expect(options).toHaveLength(2);
    expect(options[0].service).toBe("standard");
    expect(options[1].service).toBe("express");
    expect(options[0].cost).toBeLessThan(options[1].cost);
    expect(options[0].eta).toBe("2–4 business days");
    expect(options[1].eta).toBe("next business day");
  });
});

describe("totalWeightGrams", () => {
  it("multiplies per-item weight by quantity", () => {
    expect(
      totalWeightGrams([{ weight_grams: 300, quantity: 2 }, { weight_grams: 150, quantity: 1 }], 400),
    ).toBe(750);
  });

  it("uses the store default when a product has no weight set", () => {
    expect(totalWeightGrams([{ weight_grams: 0, quantity: 2 }], 400)).toBe(800);
    expect(totalWeightGrams([{ weight_grams: null, quantity: 1 }], 250)).toBe(250);
  });
});
