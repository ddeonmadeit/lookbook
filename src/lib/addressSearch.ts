/**
 * Address suggestions as you type, so shoppers pick their address instead of typing it all out.
 *
 * Uses Photon (photon.komoot.io): free OpenStreetMap geocoding, no key needed. Suggestions are
 * limited to the country being shipped to. For Australia the suburb is the city line and states
 * are abbreviated (NSW, VIC…), the way Australia Post and Stripe expect. Where a house number
 * isn't on the map, the number the shopper typed is kept ("175" + "Cathedral Street").
 */

export interface AddressSuggestion {
  id: string;
  /** One line, for the list: "175 Cathedral Street, Woolloomooloo NSW 2011". */
  label: string;
  line1: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

export interface PhotonFeature {
  properties?: {
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    locality?: string;
    city?: string;
    postcode?: string;
    state?: string;
    countrycode?: string;
  };
}

const AU_STATES: Record<string, string> = {
  "New South Wales": "NSW",
  Victoria: "VIC",
  Queensland: "QLD",
  "South Australia": "SA",
  "Western Australia": "WA",
  Tasmania: "TAS",
  "Northern Territory": "NT",
  "Australian Capital Territory": "ACT",
};

/** Mainland Australia and Tasmania, to keep Australian searches in Australia. */
const AU_BBOX = "112.9,-43.7,153.7,-10.6";

/** The house or unit number typed at the start ("175", "5/175", "12A"), if any. */
export function typedNumber(query: string): string | null {
  const m = query.trim().match(/^(\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?)(?=\s)/i);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/** One map result as an address in `country`, or null if it isn't one we can ship to. */
export function toSuggestion(feature: PhotonFeature, query: string, country: string): AddressSuggestion | null {
  const p = feature.properties;
  if (!p || (p.countrycode ?? "").toUpperCase() !== country) return null;
  const isStreet = p.type === "street";
  const street = isStreet ? p.name : p.street;
  if (!street) return null;
  const number = !isStreet && p.housenumber ? p.housenumber : typedNumber(query);
  const line1 = number ? `${number} ${street}` : street;
  const au = country === "AU";
  const city = (au ? p.district || p.locality || p.city : p.city || p.locality || p.district) ?? "";
  const state = (au ? AU_STATES[p.state ?? ""] ?? p.state : p.state) ?? "";
  const postcode = p.postcode ?? "";
  // Australian shipping is priced on the postcode, so a result without one is no use there.
  if (!city || (au && !/^\d{4}$/.test(postcode))) return null;
  const label = `${line1}, ${[city, state, postcode].filter(Boolean).join(" ")}`;
  return { id: label.toLowerCase(), label, line1, city, state, postcode, country };
}

/** Map results → up to `limit` distinct addresses in `country`. */
export function toSuggestions(features: PhotonFeature[], query: string, country: string, limit = 5): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const f of features) {
    const s = toSuggestion(f, query, country);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchAddresses(query: string, country: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "12");
  url.searchParams.set("lang", "en");
  url.searchParams.append("layer", "house");
  url.searchParams.append("layer", "street");
  if (country === "AU") url.searchParams.set("bbox", AU_BBOX);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return toSuggestions(data.features ?? [], q, country);
}
