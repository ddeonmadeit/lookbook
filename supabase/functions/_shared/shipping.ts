// Weight- and destination-based shipping quotes for parcels sent from Sydney.
//
// Zones mirror Australia Post's pricing geography. Domestically that means the
// destination *postcode*, not the city: Australia Post prices on the
// origin→destination postcode pair, city names aren't unique, and a suburb name
// tells you nothing about the band. Internationally it's the country.
//
// Actual prices live in the `shipping_rates` table so they can be corrected
// from the dashboard when the carrier reprices; this module only decides which
// zone and weight tier apply.

export type ShippingZone =
  | "AU_SYD"
  | "AU_NSW"
  | "AU_INTER"
  | "AU_REMOTE"
  | "NZ"
  | "ASIA"
  | "NA_ME"
  | "ROW";

export type ShippingService = "standard" | "express";

export const ZONE_LABELS: Record<ShippingZone, string> = {
  AU_SYD: "Sydney metro",
  AU_NSW: "NSW & ACT",
  AU_INTER: "VIC, QLD, SA & TAS",
  AU_REMOTE: "WA & NT",
  NZ: "New Zealand",
  ASIA: "Asia & Pacific",
  NA_ME: "North America & Middle East",
  ROW: "Rest of world",
};

export const SERVICE_LABELS: Record<ShippingService, string> = {
  standard: "Standard",
  express: "Express",
};

/** Rough transit expectations, shown at checkout so the choice means something. */
export const SERVICE_ETA: Record<ShippingZone, Record<ShippingService, string>> = {
  AU_SYD: { standard: "2–4 business days", express: "next business day" },
  AU_NSW: { standard: "2–5 business days", express: "1–2 business days" },
  AU_INTER: { standard: "3–7 business days", express: "1–3 business days" },
  AU_REMOTE: { standard: "5–10 business days", express: "2–4 business days" },
  NZ: { standard: "6–12 business days", express: "3–6 business days" },
  ASIA: { standard: "7–14 business days", express: "4–8 business days" },
  NA_ME: { standard: "8–16 business days", express: "5–9 business days" },
  ROW: { standard: "10–20 business days", express: "6–12 business days" },
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
  const map: Record<string, ShippingZone> = { NZ: "NZ" };
  for (const c of ASIA_PACIFIC) map[c] = "ASIA";
  for (const c of NORTH_AMERICA_MIDDLE_EAST) map[c] = "NA_ME";
  return map;
})();

function inAny(n: number, ranges: Array<[number, number]>) {
  return ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

/**
 * Australian postcode → zone. Sydney metro covers the city, the Central Coast
 * fringe and the Penrith/Blue Mountains corridor; everything else in 2xxx (plus
 * ACT) is regional NSW.
 */
export function auZoneForPostcode(postcode: string | null | undefined): ShippingZone {
  const digits = String(postcode ?? "").replace(/\D/g, "");
  if (digits.length !== 4) return "AU_NSW"; // unknown: price as the middle band
  const n = Number(digits);

  if (inAny(n, [[1000, 2249], [2555, 2574], [2740, 2786]])) return "AU_SYD";
  if (inAny(n, [[2000, 2999], [200, 299]])) return "AU_NSW"; // incl. ACT
  if (inAny(n, [[3000, 3999], [8000, 8999]])) return "AU_INTER"; // VIC
  if (inAny(n, [[4000, 4999], [9000, 9999]])) return "AU_INTER"; // QLD
  if (inAny(n, [[5000, 5999]])) return "AU_INTER"; // SA
  if (inAny(n, [[7000, 7999]])) return "AU_INTER"; // TAS
  if (inAny(n, [[6000, 6999]])) return "AU_REMOTE"; // WA
  if (inAny(n, [[800, 999]])) return "AU_REMOTE"; // NT
  return "AU_NSW";
}

/** Destination → zone. Australian addresses resolve on postcode, not country. */
export function zoneForDestination(
  country: string | null | undefined,
  postcode?: string | null,
): ShippingZone {
  const cc = String(country ?? "").trim().toUpperCase();
  if (!cc) return "ROW";
  if (cc === "AU") return auZoneForPostcode(postcode);
  return ZONE_BY_COUNTRY[cc] ?? "ROW";
}

export interface RateRow {
  zone: string;
  max_weight_grams: number;
  price: number | string;
  service?: string;
}

export interface QuoteInput {
  country: string;
  postcode?: string | null;
  /** Total billable weight of the parcel in grams. */
  weightGrams: number;
  /** Order subtotal, used for the free-shipping threshold. */
  subtotal: number;
  rates: RateRow[];
  handlingFee: number;
  freeThreshold?: number | null;
  /** Used only when the rate card has no rows for the zone. */
  flatRateFallback?: number;
  service?: ShippingService;
}

export interface Quote {
  zone: ShippingZone;
  service: ShippingService;
  /** Final amount to charge, handling fee included. */
  cost: number;
  /** Carrier portion, before the handling fee. */
  carrierCost: number;
  handlingFee: number;
  weightGrams: number;
  /** How many parcels the weight had to be split across. */
  parcels: number;
  free: boolean;
  /** Customer-facing name, e.g. "Express — Sydney metro". */
  label: string;
  /** Rough transit time for this zone/service. */
  eta: string;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Price a parcel for one service level. Picks the cheapest weight tier that
 * covers the parcel; anything heavier than the largest tier is split across
 * multiple parcels. The handling fee is added once per order.
 */
export function quoteShipping(input: QuoteInput): Quote {
  const service: ShippingService = input.service ?? "standard";
  const zone = zoneForDestination(input.country, input.postcode);
  const weightGrams = Math.max(1, Math.round(input.weightGrams || 0));
  const handlingFee = Math.max(0, Number(input.handlingFee) || 0);
  const eta = SERVICE_ETA[zone][service];
  const label = `${SERVICE_LABELS[service]} — ${ZONE_LABELS[zone]}`;

  // Free shipping only ever applies to the standard service; express stays
  // payable, otherwise the threshold silently gifts the dearest option.
  const free =
    service === "standard" &&
    input.freeThreshold !== null &&
    input.freeThreshold !== undefined &&
    input.subtotal >= Number(input.freeThreshold);

  if (free) {
    return {
      zone, service, cost: 0, carrierCost: 0, handlingFee: 0,
      weightGrams, parcels: 1, free: true,
      label: "Free standard shipping", eta,
    };
  }

  const tiers = input.rates
    .filter((r) => r.zone === zone && (r.service ?? "standard") === service)
    .map((r) => ({ max: Number(r.max_weight_grams), price: Number(r.price) }))
    .filter((r) => Number.isFinite(r.max) && Number.isFinite(r.price))
    .sort((a, b) => a.max - b.max);

  // No rate card for this zone/service: fall back to the legacy flat rate so
  // checkout still works rather than quoting zero.
  if (tiers.length === 0) {
    const carrierCost = Math.max(0, Number(input.flatRateFallback) || 0);
    return {
      zone, service,
      cost: round2(carrierCost + handlingFee),
      carrierCost: round2(carrierCost),
      handlingFee, weightGrams, parcels: 1, free: false, label, eta,
    };
  }

  const fitting = tiers.find((t) => t.max >= weightGrams);
  let carrierCost: number;
  let parcels = 1;

  if (fitting) {
    carrierCost = fitting.price;
  } else {
    const largest = tiers[tiers.length - 1];
    parcels = Math.ceil(weightGrams / largest.max);
    carrierCost = largest.price * parcels;
  }

  return {
    zone, service,
    cost: round2(carrierCost + handlingFee),
    carrierCost: round2(carrierCost),
    handlingFee, weightGrams, parcels, free: false, label, eta,
  };
}

/** Both service levels for a destination, cheapest first. */
export function quoteAllServices(input: Omit<QuoteInput, "service">): Quote[] {
  const services: ShippingService[] = ["standard", "express"];
  return services
    .map((service) => quoteShipping({ ...input, service }))
    .sort((a, b) => a.cost - b.cost);
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
