// Weight-based shipping quotes for parcels sent from Sydney, Australia.
//
// Zones mirror Australia Post's international zoning. The actual prices live
// in the `shipping_rates` table so they can be corrected from the dashboard
// when the carrier changes its pricing; this module only decides which zone a
// country falls into and which weight tier a parcel needs.

export type ShippingZone = "AU" | "NZ" | "ASIA" | "NA_ME" | "ROW";

export const ZONE_LABELS: Record<ShippingZone, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  ASIA: "Asia & Pacific",
  NA_ME: "North America & Middle East",
  ROW: "Rest of world",
};

// Australia Post Zone 2 — Asia & the Pacific.
const ASIA_PACIFIC = [
  "CN", "HK", "MO", "TW", "JP", "KR", "MN", "SG", "MY", "TH", "VN", "PH", "ID",
  "BN", "KH", "LA", "MM", "TL", "IN", "BD", "LK", "NP", "PK", "BT", "MV",
  "PG", "FJ", "SB", "VU", "NC", "WS", "TO", "CK", "PF", "NR", "TV", "KI",
  "FM", "MH", "PW", "GU", "AS", "NU", "NF", "WF", "TK",
];

// Australia Post Zone 3 — USA, Canada & the Middle East.
const NORTH_AMERICA_MIDDLE_EAST = [
  "US", "CA", "PR", "VI",
  "AE", "SA", "QA", "KW", "BH", "OM", "IL", "PS", "JO", "LB", "SY", "IQ",
  "IR", "YE", "TR",
];

const ZONE_BY_COUNTRY: Record<string, ShippingZone> = (() => {
  const map: Record<string, ShippingZone> = { AU: "AU", NZ: "NZ" };
  for (const c of ASIA_PACIFIC) map[c] = "ASIA";
  for (const c of NORTH_AMERICA_MIDDLE_EAST) map[c] = "NA_ME";
  return map;
})();

/** ISO-3166 alpha-2 country code -> shipping zone. Unknown codes bill as ROW. */
export function zoneForCountry(country: string | null | undefined): ShippingZone {
  if (!country) return "ROW";
  return ZONE_BY_COUNTRY[country.trim().toUpperCase()] ?? "ROW";
}

export interface RateRow {
  zone: string;
  max_weight_grams: number;
  price: number | string;
}

export interface QuoteInput {
  country: string;
  /** Total billable weight of the parcel in grams. */
  weightGrams: number;
  /** Order subtotal, used for the free-shipping threshold. */
  subtotal: number;
  rates: RateRow[];
  handlingFee: number;
  freeThreshold?: number | null;
  /** Used only when the rate card has no rows for the zone. */
  flatRateFallback?: number;
}

export interface Quote {
  zone: ShippingZone;
  /** Final amount to charge, handling fee included. */
  cost: number;
  /** Carrier portion, before the handling fee. */
  carrierCost: number;
  handlingFee: number;
  weightGrams: number;
  /** How many parcels the weight had to be split across. */
  parcels: number;
  free: boolean;
  /** Customer-facing description, e.g. "Standard shipping to Asia & Pacific". */
  label: string;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Price a parcel. Picks the cheapest weight tier that covers the parcel; a
 * parcel heavier than the largest tier is split across multiple parcels. The
 * handling fee is added once per order, on top of the carrier cost.
 */
export function quoteShipping(input: QuoteInput): Quote {
  const zone = zoneForCountry(input.country);
  const weightGrams = Math.max(1, Math.round(input.weightGrams || 0));
  const handlingFee = Math.max(0, Number(input.handlingFee) || 0);

  const free =
    input.freeThreshold !== null &&
    input.freeThreshold !== undefined &&
    input.subtotal >= Number(input.freeThreshold);

  if (free) {
    return {
      zone,
      cost: 0,
      carrierCost: 0,
      handlingFee: 0,
      weightGrams,
      parcels: 1,
      free: true,
      label: "Free shipping",
    };
  }

  const tiers = input.rates
    .filter((r) => r.zone === zone)
    .map((r) => ({ max: Number(r.max_weight_grams), price: Number(r.price) }))
    .filter((r) => Number.isFinite(r.max) && Number.isFinite(r.price))
    .sort((a, b) => a.max - b.max);

  // No rate card for this zone: fall back to the legacy flat rate so checkout
  // still works rather than quoting zero.
  if (tiers.length === 0) {
    const carrierCost = Math.max(0, Number(input.flatRateFallback) || 0);
    return {
      zone,
      cost: round2(carrierCost + handlingFee),
      carrierCost: round2(carrierCost),
      handlingFee,
      weightGrams,
      parcels: 1,
      free: false,
      label: `Standard shipping to ${ZONE_LABELS[zone]}`,
    };
  }

  const fitting = tiers.find((t) => t.max >= weightGrams);
  let carrierCost: number;
  let parcels = 1;

  if (fitting) {
    carrierCost = fitting.price;
  } else {
    // Heavier than anything on the rate card — split across max-size parcels.
    const largest = tiers[tiers.length - 1];
    parcels = Math.ceil(weightGrams / largest.max);
    carrierCost = largest.price * parcels;
  }

  return {
    zone,
    cost: round2(carrierCost + handlingFee),
    carrierCost: round2(carrierCost),
    handlingFee,
    weightGrams,
    parcels,
    free: false,
    label: `Standard shipping to ${ZONE_LABELS[zone]}`,
  };
}

/** Billable weight of a set of cart lines, falling back to a default per item. */
export function totalWeightGrams(
  lines: Array<{ weight_grams?: number | null; quantity: number }>,
  defaultItemWeight: number,
): number {
  return lines.reduce((sum, l) => {
    const each = Number(l.weight_grams) > 0 ? Number(l.weight_grams) : defaultItemWeight;
    return sum + each * Math.max(1, l.quantity);
  }, 0);
}
