/**
 * Contacts: the store's single address book (see the contacts migration).
 * The database does the real merging and refuses duplicates; this module
 * reads contact lists people upload (Shopify/Klaviyo exports, the merged
 * list, any spreadsheet saved as CSV) into the shape import_contacts() takes,
 * and previews how many distinct people a file holds.
 *
 * phoneKey/emailKey/nameKey mirror the SQL contact_*_key functions exactly
 * (both are checked against src/test/fixtures/contactKeys.json).
 */

/** One person as import_contacts() accepts them. */
export interface ContactInput {
  name?: string;
  email?: string;
  phone?: string;
  other_emails?: string[];
  other_phones?: string[];
  address?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  location?: string;
  email_consent?: boolean;
  sms_consent?: boolean;
  orders?: number;
  spent?: number;
  tags?: string;
  note?: string;
  sources?: string[];
}

/** A contact as stored. */
export interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  other_emails: string[];
  other_phones: string[];
  address: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  location: string | null;
  email_consent: boolean | null;
  sms_consent: boolean | null;
  shopify_orders: number | null;
  shopify_spent: number | null;
  tags: string | null;
  note: string | null;
  sources: string[];
  created_at: string;
}

export interface ImportTally {
  added: number;
  updated: number;
  merged: number;
  unchanged: number;
  skipped: number;
}

/** Phone number in international form (+61412345678), or null if there's no real number. */
export function phoneKey(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/[^0-9+]/g, "");
  if (!d) return null;
  d = d[0] + d.slice(1).replace(/\+/g, "");
  if (!/[0-9]{6,}/.test(d)) return null;
  let k: string;
  if (d.startsWith("+")) k = d;
  else if (d.startsWith("00")) k = "+" + d.slice(2);
  else if (/^0[2-478][0-9]{8}$/.test(d)) k = "+61" + d.slice(1);
  else if (/^4[0-9]{8}$/.test(d)) k = "+61" + d;
  else k = "+" + d;
  // "+61 0412 345 678": the trunk 0 doesn't belong after the country code
  return /^\+610[0-9]{9}$/.test(k) ? "+61" + k.slice(4) : k;
}

// Mistyped mail domains seen at checkout; mail to them can never arrive.
const DOMAIN_TYPOS: Record<string, string> = {
  "gnail.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yahoo.con": "yahoo.com",
  "icloud.con": "icloud.com",
  "outlook.con": "outlook.com",
};

/** Lowercased email with obvious domain typos fixed, or null if it isn't an email address. */
export function emailKey(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/.test(v)) return null;
  const at = v.lastIndexOf("@");
  const domain = v.slice(at + 1);
  return `${v.slice(0, at)}@${DOMAIN_TYPOS[domain] ?? domain}`;
}

/** Name compared ignoring case, spacing and curly vs straight apostrophes. */
export function nameKey(raw: string | null | undefined): string | null {
  const v = String(raw ?? "")
    .trim()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return v || null;
}

/** Parse CSV text (quoted fields, embedded commas/newlines, BOM, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim().replace(/^'/, "");
  return t || undefined;
};
const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
function yesNo(v: string | undefined): boolean | undefined {
  const t = (v ?? "").trim().toLowerCase();
  if (["yes", "true", "y", "1", "subscribed"].includes(t)) return true;
  if (["no", "false", "n", "0", "unsubscribed", "never subscribed"].includes(t)) return false;
  return undefined;
}
function num(v: string | undefined): number | undefined {
  const t = (v ?? "").replace(/[^0-9.-]/g, "");
  return /^-?[0-9]+(\.[0-9]+)?$/.test(t) ? Number(t) : undefined;
}

export type ContactLayout = "merged list" | "Shopify export" | "contact list";

/**
 * Which column holds what, by header name. Works for the merged list, a
 * Shopify customer export, a Klaviyo profile export and most hand-made
 * spreadsheets ("Name"/"First name"/"Email address"/"Mobile"…).
 */
function columnFinder(header: string[]) {
  const h = header.map((x) => x.trim().toLowerCase());
  return (...tests: Array<RegExp | ((name: string) => boolean)>) => {
    for (const t of tests) {
      const i = h.findIndex((name) => (t instanceof RegExp ? t.test(name) : t(name)));
      if (i !== -1) return i;
    }
    return -1;
  };
}

/** Turn a parsed contact file (header row first) into people for import_contacts(). */
export function rowsToPeople(table: string[][], source?: string): { people: ContactInput[]; layout: ContactLayout } {
  const [header = [], ...rows] = table;
  const col = columnFinder(header);
  const at = (r: string[], i: number) => (i === -1 ? undefined : r[i]);
  const shopify = header.some((x) => x.trim() === "Customer ID");
  const merged = ["name", "email", "phone", "other_emails", "other_phones"].every((x) => header.includes(x));
  const layout: ContactLayout = merged ? "merged list" : shopify ? "Shopify export" : "contact list";
  const consentWord = /consent|accepts|subscri|opt/;

  const iName = col(/^(full |customer |contact )?name$/);
  const iFirst = col(/^first ?name$/, /^given name$/);
  const iLast = col(/^last ?name$/, /^surname$/, /^family name$/);
  const iEmail = col(/^e-?mail( address)?$/, (n) => n.includes("email") && !consentWord.test(n));
  const iPhone = col(/^phone$/, /^(phone|mobile|cell)( number)?$/, (n) => /phone|mobile/.test(n) && !consentWord.test(n) && !n.includes("address"));
  const iPhone2 = col(/^default address phone$/);
  const iAddress = col(/^(default address )?address ?1?$/, /^street( address)?$/);
  const iAddress2 = col(/^(default address )?address ?2$/);
  const iCity = col(/^(default address )?city$/, /^suburb$/);
  const iState = col(/^(default address )?province( code)?$/, /^state( \/ region)?$/, /^region$/);
  const iPostcode = col(/^(default address )?zip$/, /^(zip|post|postal) ?code$/, /^postcode$/);
  const iCountry = col(/^(default address )?country( code)?$/);
  const iLocation = col(/^location$/);
  const iEmailOk = col(/^accepts email marketing$/, /^email (marketing )?consent$/, /^email_consent$/, /email.*(consent|subscri)/);
  const iSmsOk = col(/^accepts sms marketing$/, /^sms (marketing )?consent$/, /^sms_consent$/, /sms.*(consent|subscri)/);
  const iOrders = col(/^total orders$/, /^orders$/);
  const iSpent = col(/^total spent$/, /^spent$/);
  const iTags = col(/^tags$/);
  const iNote = col(/^note$/, /^notes$/);
  const iOtherEmails = col(/^other_emails$/);
  const iOtherPhones = col(/^other_phones$/);
  const iSources = col(/^sources$/);

  const people: ContactInput[] = [];
  for (const r of rows) {
    const name =
      clean(at(r, iName)) ?? clean([at(r, iFirst), at(r, iLast)].map((x) => (x ?? "").trim()).filter(Boolean).join(" "));
    const email = clean(at(r, iEmail));
    const phone = clean(at(r, iPhone));
    const p: ContactInput = {
      name,
      email,
      phone,
      other_emails: list(at(r, iOtherEmails)),
      other_phones: [...list(at(r, iOtherPhones)), ...(clean(at(r, iPhone2)) ? [clean(at(r, iPhone2))!] : [])],
      address: clean([at(r, iAddress), at(r, iAddress2)].map((x) => (x ?? "").trim()).filter(Boolean).join(", ")),
      city: clean(at(r, iCity)),
      state: clean(at(r, iState)),
      postcode: clean(at(r, iPostcode)),
      country: clean(at(r, iCountry)),
      location: clean(at(r, iLocation)),
      // consent only means something next to the detail it's about
      email_consent: emailKey(email) ? yesNo(at(r, iEmailOk)) : undefined,
      sms_consent: phoneKey(phone) ? yesNo(at(r, iSmsOk)) : undefined,
      orders: num(at(r, iOrders)),
      spent: num(at(r, iSpent)),
      tags: clean(at(r, iTags)),
      note: clean(at(r, iNote)),
      sources: [...list(at(r, iSources)), ...(source ? [source] : [])],
    };
    for (const k of Object.keys(p) as Array<keyof ContactInput>) {
      const v = p[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete p[k];
    }
    people.push(p);
  }
  return { people, layout };
}

/** Every email/number a person carries, normalised and prefixed ("e:"/"p:"). */
export function identifiers(p: ContactInput): string[] {
  const emails = [p.email, ...(p.other_emails ?? [])].map(emailKey).filter((x): x is string => !!x);
  const phones = [p.phone, ...(p.other_phones ?? [])].map(phoneKey).filter((x): x is string => !!x);
  return [...new Set([...emails.map((e) => `e:${e}`), ...phones.map((x) => `p:${x}`)])];
}

/**
 * How many distinct people a set of rows holds (rows sharing an email or
 * number are one person) and how many rows have nothing to go on. The
 * database's own merge is the final word; this is the preview.
 */
export function countPeople(people: ContactInput[]): { people: number; withoutDetails: number } {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let r = i;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    parent.set(i, r);
    return r;
  };
  const owner = new Map<string, number>();
  let withoutDetails = 0;
  people.forEach((p, i) => {
    const ids = identifiers(p);
    if (ids.length === 0) {
      withoutDetails++;
      return;
    }
    parent.set(i, i);
    for (const k of ids) {
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i);
      else parent.set(find(i), find(o));
    }
  });
  const roots = new Set([...parent.keys()].map(find));
  return { people: roots.size, withoutDetails };
}

/** Contacts as a CSV in the merged-list layout (re-importable). */
export function contactsToCsv(contacts: ContactRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const yn = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "");
  const header = [
    "name", "email", "phone", "other_emails", "other_phones", "address", "city", "state", "postcode", "country",
    "location", "email_consent", "sms_consent", "orders", "spent", "tags", "note", "sources",
  ];
  const rows = contacts.map((c) =>
    [
      c.name, c.email, c.phone, c.other_emails.join("; "), c.other_phones.join("; "), c.address, c.city, c.state,
      c.postcode, c.country, c.location, yn(c.email_consent), yn(c.sms_consent), c.shopify_orders ?? "",
      c.shopify_spent ?? "", c.tags, c.note, c.sources.join("; "),
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/** "+61412345678" → "+61 412 345 678" for reading; other countries as stored. */
export function formatPhone(p: string | null): string {
  if (!p) return "";
  const au = /^\+61(\d{3})(\d{3})(\d{3})$/.exec(p);
  return au ? `+61 ${au[1]} ${au[2]} ${au[3]}` : p;
}

/**
 * Whether a database error means the contacts update hasn't been run yet
 * (table or import function missing), as opposed to a real failure.
 */
export function isMissingContactsSetup(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "") ||
    /could not find the (table|function)|does not exist/i.test(error.message ?? "")
  );
}
