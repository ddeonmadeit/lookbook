import { describe, expect, it } from "vitest";
import vectors from "./fixtures/contactKeys.json";
import {
  contactsToCsv,
  countPeople,
  emailKey,
  formatPhone,
  identifiers,
  nameKey,
  parseCsv,
  phoneKey,
  rowsToPeople,
  type ContactRow,
} from "@/lib/contacts";

// The same vectors check the SQL functions in the migration, so the preview
// and the database always agree on who is the same person.
describe("normalising numbers and emails (shared with the database)", () => {
  it.each(vectors.phones as Array<[string | null, string | null]>)("phone %j → %j", (raw, expected) => {
    expect(phoneKey(raw)).toBe(expected);
  });
  it.each(vectors.emails as Array<[string | null, string | null]>)("email %j → %j", (raw, expected) => {
    expect(emailKey(raw)).toBe(expected);
  });
  it("compares names ignoring case, spacing and apostrophe style", () => {
    expect(nameKey("  Eres  D’Hoogh ")).toBe(nameKey("eres d'hoogh"));
    expect(nameKey("")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const text = '\uFEFFName,Location\r\n"Lee, Jordan","Bondi\nNSW"\r\n"Say ""hi""",x\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Location"],
      ["Lee, Jordan", "Bondi\nNSW"],
      ['Say "hi"', "x"],
    ]);
  });
});

describe("reading contact files", () => {
  it("reads a Shopify customer export, including the apostrophe-prefixed numbers and consent", () => {
    const table = parseCsv(
      [
        "Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Address1,Default Address Address2,Default Address City,Default Address Province Code,Default Address Country Code,Default Address Zip,Default Address Phone,Phone,Accepts SMS Marketing,Total Spent,Total Orders,Note,Tax Exempt,Tags",
        "'1,Jordan,Lee,jordan@example.com,yes,12 Ocean St,,Bondi,NSW,AU,'2026,'0412 000 111,'+61412000999,no,248.50,2,VIP,no,PS-Accepts-SMS",
        "'2,,,,no,,,,,,,,'+16305550000,yes,0.00,0,,no,",
        "'3,Nobody,Here,,no,,,,,,,,,no,0.00,0,,no,",
      ].join("\n"),
    );
    const { people, layout } = rowsToPeople(table, "shopify");
    expect(layout).toBe("Shopify export");
    expect(people[0]).toEqual({
      name: "Jordan Lee",
      email: "jordan@example.com",
      phone: "+61412000999",
      other_phones: ["0412 000 111"],
      address: "12 Ocean St",
      city: "Bondi",
      state: "NSW",
      postcode: "2026",
      country: "AU",
      email_consent: true,
      sms_consent: false,
      orders: 2,
      spent: 248.5,
      tags: "PS-Accepts-SMS",
      note: "VIP",
      sources: ["shopify"],
    });
    // consent is only kept next to the detail it's about
    expect(people[1]).toMatchObject({ phone: "+16305550000", sms_consent: true });
    expect(people[1].email_consent).toBeUndefined();
    expect(identifiers(people[2])).toEqual([]);
  });

  it("reads the merged list it exports, round trip", () => {
    const row: ContactRow = {
      id: "1", name: "Kai McGrath", email: "kai@example.com", phone: "+61499000111",
      other_emails: ["kai@school.example"], other_phones: [], address: null, city: "Sydney", state: "NSW",
      postcode: null, country: "AU", location: null, email_consent: true, sms_consent: null,
      shopify_orders: 3, shopify_spent: 120, tags: null, note: 'Likes "loose" fits, size L', sources: ["shopify", "klaviyo"],
      created_at: "",
    };
    const { people, layout } = rowsToPeople(parseCsv(contactsToCsv([row])));
    expect(layout).toBe("merged list");
    expect(people).toEqual([
      {
        name: "Kai McGrath", email: "kai@example.com", phone: "+61499000111", other_emails: ["kai@school.example"],
        city: "Sydney", state: "NSW", country: "AU", email_consent: true, orders: 3, spent: 120,
        note: 'Likes "loose" fits, size L', sources: ["shopify", "klaviyo"],
      },
    ]);
  });

  it("reads Klaviyo-style and hand-made sheets by their headers", () => {
    const klaviyo = rowsToPeople(
      parseCsv("Email,Phone Number,First Name,Last Name,City,State / Region,Country,Zip Code,Email Marketing Consent,SMS Consent\n" +
        "a@example.com,+44 7700 900123,Ann,Bee,London,,United Kingdom,,SUBSCRIBED,NEVER SUBSCRIBED"),
    ).people[0];
    expect(klaviyo).toMatchObject({ name: "Ann Bee", email: "a@example.com", phone: "+44 7700 900123", city: "London",
      country: "United Kingdom", email_consent: true, sms_consent: false });
    const handMade = rowsToPeople(parseCsv("Full name,Email address,Mobile\nSam Patel,SAM@example.com,0400 111 222")).people[0];
    expect(handMade).toMatchObject({ name: "Sam Patel", email: "SAM@example.com", phone: "0400 111 222" });
    const emailsOnly = rowsToPeople(parseCsv("Email\nx@example.com\ny@example.com")).people;
    expect(emailsOnly).toEqual([{ email: "x@example.com" }, { email: "y@example.com" }]);
  });
});

describe("countPeople", () => {
  it("counts rows sharing an email or number (however written) as one person", () => {
    const { people } = rowsToPeople(
      parseCsv(
        "Name,Email,Phone\n" +
          "Pat Example,pat@example.com,\n" +
          "Pat Example,,0400 000 123\n" +
          ",PAT@example.com,+61400000123\n" + // links the two rows above
          ",,+61 0400 000 123\n" +
          "Someone Else,else@example.com,\n" +
          "No Details,,\n",
      ),
    );
    expect(countPeople(people)).toEqual({ people: 2, withoutDetails: 1 });
  });
});

describe("formatPhone", () => {
  it("spaces Australian mobiles for reading and leaves others alone", () => {
    expect(formatPhone("+61412345678")).toBe("+61 412 345 678");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
    expect(formatPhone(null)).toBe("");
  });
});
