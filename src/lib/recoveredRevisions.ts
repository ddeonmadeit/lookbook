import type { ManualImage, ManualOption, ManualVariant } from "@/lib/products";
import type { ImportRow } from "@/lib/shopifyImport";

/**
 * Newer versions of products that were already restored from the old Shopify
 * store. The first restore used each product's newest full archived record,
 * but for some products a later archive (April 2026) turned out to hold a
 * newer one: new photos, a reworded description, relabelled sizes.
 *
 * The recovered catalogue now holds those newer versions. For products already
 * restored, each revision records what the first restore wrote for the parts
 * that changed; a part is only brought up to date while the product still
 * holds exactly that, so nothing the owner has edited since is overwritten.
 */

export type RevisionPart = "photos" | "description" | "sizes" | "weight";

export interface Revision {
  /** What changed, shown to the owner. */
  note: string;
  /** What the first restore wrote, for each part this revision changes. */
  previous: {
    images?: string[];
    description_html?: string | null;
    /** Options and variants together: a size relabel changes both. */
    sizes?: { options: ManualOption[]; variants: ManualVariant[] };
    weight_grams?: number;
  };
}

/** Revisions by product handle. */
export type Revisions = Record<string, Revision>;

/** The fields of a stored product a revision can change. */
export interface RevisableRow {
  images: ManualImage[];
  description_html: string | null;
  options: ManualOption[];
  variants: ManualVariant[];
  weight_grams: number;
}

export interface RevisionPatch {
  images?: ManualImage[];
  description?: string | null;
  description_html?: string | null;
  options?: ManualOption[];
  variants?: ManualVariant[];
  weight_grams?: number;
}

export interface PlannedRevision {
  patch: RevisionPatch;
  applied: RevisionPart[];
}

/** Deep equality for JSON values that ignores key order (the database reorders jsonb keys). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** The parts a revision changes. */
export function revisionParts(revision: Revision): RevisionPart[] {
  const { previous } = revision;
  const parts: RevisionPart[] = [];
  if (previous.images) parts.push("photos");
  if (previous.description_html !== undefined) parts.push("description");
  if (previous.sizes) parts.push("sizes");
  if (previous.weight_grams !== undefined) parts.push("weight");
  return parts;
}

/**
 * Which parts of a restored product to bring up to its newer version, and the
 * fields that does. `latest` is the newer version as the restore would write it.
 * A part that no longer holds what the restore wrote is skipped: either the
 * owner edited it, or it was already brought up to date (and optimised since).
 */
export function planRevision(row: RevisableRow, revision: Revision, latest: ImportRow): PlannedRevision {
  const { previous } = revision;
  const patch: RevisionPatch = {};
  const applied: RevisionPart[] = [];

  if (previous.images && sameJson(row.images.map((i) => i.url), previous.images)) {
    patch.images = latest.images;
    applied.push("photos");
  }
  if (previous.description_html !== undefined && (row.description_html ?? null) === previous.description_html) {
    patch.description = latest.description;
    patch.description_html = latest.description_html;
    applied.push("description");
  }
  if (previous.sizes && sameJson(row.options ?? [], previous.sizes.options) && sameJson(row.variants ?? [], previous.sizes.variants)) {
    patch.options = latest.options;
    patch.variants = latest.variants;
    applied.push("sizes");
  }
  if (previous.weight_grams !== undefined && row.weight_grams === previous.weight_grams) {
    patch.weight_grams = latest.weight_grams;
    applied.push("weight");
  }
  return { patch, applied };
}
