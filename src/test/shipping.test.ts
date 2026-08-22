import { describe, expect, it } from "vitest";
import {
  quoteShipping,
  totalWeightGrams,
  zoneForCountry,
  type RateRow,
} from "../../supabase/functions/_shared/shipping";

// Mirrors the rows seeded by 20260819040000_worldwide_shipping.sql.
const RATES: RateRow[] = [
  { zone: "AU", max_weight_grams: 500, price: 10.95 },
  { zone: "AU", max_weight_grams: 1000, price: 12.7 },
  { zone: "AU", max_weight_grams: 2000, price: 15.1 },
  { zone: "NZ", max_weight_grams: 500, price: 16.85 },
  { zone: "NZ", max_weight_grams: 1000, price: 21.6 },
  { zone: "ASIA", max_weight_grams: 1000, price: 29.2 },
  { zone: "NA_ME", max_weight_grams: 1000, price: 38.65 },
  { zone: "NA_ME", max_weight_grams: 2000, price: 60.2 },
  { zone: "ROW", max_weight_grams: 1000, price: 45.05 },
  { zone: "ROW", max_weight_grams: 2000, price: 72.45 },
];

const HANDLING = 8.4;

function quote(country: string, weightGrams: number, subtotal = 100, freeThreshold: number | null = null) {
  return quoteShipping({
    country,
    weightGrams,
    subtotal,
    rates: RATES,
    handlingFee: HANDLING,
    freeThreshold,
  });
}

describe("zoneForCountry", () => {
  it("maps countries to Australia Post zones", () => {
    expect(zoneForCountry("AU")).toBe("AU");
    expect(zoneForCountry("NZ")).toBe("NZ");
    expect(zoneForCountry("JP")).toBe("ASIA");
    expect(zoneForCountry("SG")).toBe("ASIA");
    expect(zoneForCountry("US")).toBe("NA_ME");
    expect(zoneForCountry("AE")).toBe("NA_ME");
    expect(zoneForCountry("GB")).toBe("ROW");
    expect(zoneForCountry("BR")).toBe("ROW");
  });

  it("is case-insensitive and defaults unknown destinations to rest-of-world", () => {
    expect(zoneForCountry("us")).toBe("NA_ME");
    expect(zoneForCountry("ZZ")).toBe("ROW");
    expect(zoneForCountry(null)).toBe("ROW");
  });
});

describe("quoteShipping", () => {
  it("adds the handling fee on top of the carrier rate", () => {
    const q = quote("AU", 400);
    expect(q.carrierCost).toBe(10.95);
    expect(q.handlingFee).toBe(8.4);
    expect(q.cost).toBe(19.35);
  });

  it("prices each zone from its own rate card", () => {
    expect(quote("US", 900).cost).toBe(47.05); // 38.65 + 8.40
    expect(quote("GB", 1500).cost).toBe(80.85); // 72.45 + 8.40
    expect(quote("NZ", 600).cost).toBe(30.0); // 21.60 + 8.40
    expect(quote("JP", 800).cost).toBe(37.6); // 29.20 + 8.40
  });

  it("steps up to the next weight tier as the parcel gets heavier", () => {
    expect(quote("AU", 500).carrierCost).toBe(10.95);
    expect(quote("AU", 501).carrierCost).toBe(12.7);
    expect(quote("AU", 1001).carrierCost).toBe(15.1);
  });

  it("splits a parcel heavier than the largest tier into multiple parcels", () => {
    const q = quote("AU", 4500); // largest AU tier here is 2kg @ 15.10
    expect(q.parcels).toBe(3);
    expect(q.carrierCost).toBe(45.3);
    expect(q.cost).toBe(53.7); // handling charged once per order
  });

  it("ships free above the threshold, with no handling fee", () => {
    const q = quote("US", 900, 400, 300);
    expect(q.free).toBe(true);
    expect(q.cost).toBe(0);
  });

  it("still charges normally below the threshold", () => {
    expect(quote("US", 900, 100, 300).cost).toBe(47.05);
  });

  it("falls back to the flat rate when a zone has no rates", () => {
    const q = quoteShipping({
      country: "GB",
      weightGrams: 500,
      subtotal: 100,
      rates: [],
      handlingFee: HANDLING,
      flatRateFallback: 20,
    });
    expect(q.cost).toBe(28.4);
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
