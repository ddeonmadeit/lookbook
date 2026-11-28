import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAddresses, toSuggestion, toSuggestions, typedNumber, type PhotonFeature } from "@/lib/addressSearch";

const f = (properties: PhotonFeature["properties"]): PhotonFeature => ({ properties });
const cathedral = f({ type: "street", name: "Cathedral Street", district: "Woolloomooloo", city: "Sydney", postcode: "2011", state: "New South Wales", countrycode: "AU" });
const george = f({ type: "house", housenumber: "12", street: "George Street", district: "Gladesville", city: "Sydney", postcode: "2111", state: "New South Wales", countrycode: "AU" });

describe("the number typed at the start", () => {
  it("is a house, unit/house or lettered number", () => {
    expect(typedNumber("175 Cathedral")).toBe("175");
    expect(typedNumber("5/175 Cathedral")).toBe("5/175");
    expect(typedNumber("5 / 175 Cathedral")).toBe("5/175");
    expect(typedNumber("12A George")).toBe("12A");
  });
  it("isn't there for a street name alone", () => {
    expect(typedNumber("Cathedral St")).toBeNull();
    expect(typedNumber("175")).toBeNull(); // still typing
  });
});

describe("an Australian address from the map", () => {
  it("uses the house number and street, the suburb, and the short state", () => {
    expect(toSuggestion(george, "12 George", "AU")).toEqual({
      id: "12 george street, gladesville nsw 2111",
      label: "12 George Street, Gladesville NSW 2111",
      line1: "12 George Street",
      city: "Gladesville",
      state: "NSW",
      postcode: "2111",
      country: "AU",
    });
  });
  it("keeps the typed number when only the street is mapped", () => {
    expect(toSuggestion(cathedral, "175 Cath", "AU")?.line1).toBe("175 Cathedral Street");
    expect(toSuggestion(cathedral, "Cathedral", "AU")?.line1).toBe("Cathedral Street");
  });
  it("needs a postcode, since shipping is priced on it", () => {
    expect(toSuggestion(f({ ...cathedral.properties, postcode: undefined }), "175 Cath", "AU")).toBeNull();
  });
});

describe("other countries", () => {
  it("use the city, the state as given, and any postcode", () => {
    const auckland = f({ type: "house", housenumber: "1", street: "Queen Street", district: "City Centre", city: "Auckland", postcode: "1010", state: "Auckland", countrycode: "NZ" });
    expect(toSuggestion(auckland, "1 Queen", "NZ")).toMatchObject({ line1: "1 Queen Street", city: "Auckland", state: "Auckland", postcode: "1010" });
  });
  it("never show up when shipping somewhere else", () => {
    expect(toSuggestion(george, "12 George", "NZ")).toBeNull();
  });
});

describe("the list", () => {
  it("drops repeats and anything unusable, and stops at the limit", () => {
    const list = toSuggestions([cathedral, cathedral, f({ type: "street", countrycode: "AU" }), george], "175 Cath", "AU");
    // A mapped house number wins over the typed one.
    expect(list.map((s) => s.line1)).toEqual(["175 Cathedral Street", "12 George Street"]);
    expect(toSuggestions([cathedral, george], "x", "AU", 1)).toHaveLength(1);
  });
});

describe("looking addresses up", () => {
  afterEach(() => vi.restoreAllMocks());
  it("waits for a few characters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await searchAddresses("17", "AU")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("asks for houses and streets, kept to Australia when shipping there", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ features: [cathedral] })));
    const found = await searchAddresses("175 Cath", "AU");
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.origin).toBe("https://photon.komoot.io");
    expect(url.searchParams.get("q")).toBe("175 Cath");
    expect(url.searchParams.getAll("layer")).toEqual(["house", "street"]);
    expect(url.searchParams.get("bbox")).toBeTruthy();
    expect(found[0].label).toBe("175 Cathedral Street, Woolloomooloo NSW 2011");
  });
  it("says so when the lookup fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    await expect(searchAddresses("175 Cath", "AU")).rejects.toThrow();
  });
});
