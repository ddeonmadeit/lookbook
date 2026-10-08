import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { SHOPIFY_HANDLE_ORDER, type ProductRow } from "@/lib/products";
import {
  planImport,
  withPositions,
  type ImportCandidate,
  type ImportRow,
  type ShopifyImportNode,
} from "@/lib/shopifyImport";
import { downloadImage, storeOptimisedPhoto } from "@/lib/storeImage";
import { type FallbackType, type MediaMap, type PhotoMap, rewriteDescription } from "@/lib/photoUpdates";
import { PHONE_SHEET, keepKeyboardClosed } from "./phoneSheet";

/**
 * The old Shopify catalogue, recovered from Common Crawl's archived copies of
 * the store's pages (the store itself is closed). Loaded on demand so only
 * this dialog ever downloads it.
 */
const BASE = import.meta.env.BASE_URL;

/** A staged (saved, optimised) copy of a recovered photo, keyed by its full-size path. */
interface StagedCopy {
  thumb: string;
  fallbackType: FallbackType;
}

interface RecoveredCatalogue {
  nodes: ShopifyImportNode[];
  staged: Map<string, StagedCopy>;
  media: MediaMap;
}

/**
 * The recovered catalogue with every photo pointed at its saved, optimised copy
 * on this site instead of Shopify's CDN (Shopify can drop the closed store's
 * files at any time). Loaded on demand so only this dialog ever downloads it.
 */
async function loadRecoveredCatalogue(): Promise<RecoveredCatalogue> {
  const [cat, opt] = await Promise.all([import("@/data/recoveredShopifyCatalogue.json"), import("@/data/photoOptimisations.json")]);
  const { photos, media } = opt.default as { photos: PhotoMap; media: MediaMap };
  const staged = new Map<string, StagedCopy>();
  const nodes = (cat.default as ShopifyImportNode[]).map((n) => ({
    ...n,
    images: {
      edges: n.images.edges.map((e) => {
        const copy = photos[e.node.url];
        if (!copy) return e;
        const full = BASE + copy.full;
        staged.set(full, { thumb: BASE + copy.thumb, fallbackType: copy.alpha ? "image/png" : "image/jpeg" });
        return { node: { ...e.node, url: full } };
      }),
    },
  }));
  return { nodes, staged, media };
}

/**
 * Current store products, read fresh when the dialog opens rather than taken
 * from the Products tab: if that list failed to load, planning against it
 * would treat the store as empty and interleave imports with existing products.
 */
async function loadExistingProducts(): Promise<ProductRow[]> {
  const { data, error } = await supabase.from("products").select("*");
  if (error) throw new Error(`Couldn't read your current products: ${error.message}`);
  return (data as unknown as ProductRow[]) ?? [];
}

/**
 * Copy one recovered photo's saved, optimised copy (and its thumbnail) into our
 * storage. If that fails the photo keeps pointing at the copy on this site, and
 * the summary says why.
 */
async function copyImage(
  url: string,
  handle: string,
  index: number,
  staged: Map<string, StagedCopy>,
): Promise<{ url: string; thumb?: string; error?: string }> {
  const copy = staged.get(url);
  if (!copy) return { url, error: "no saved copy of this photo" };
  try {
    const [full, thumb] = await Promise.all([downloadImage(url, false), downloadImage(copy.thumb, false)]);
    return await storeOptimisedPhoto(full, thumb, handle, index, copy.fallbackType);
  } catch (err) {
    return { url, error: err instanceof Error ? err.message : String(err) };
  }
}

type InsertOutcome = "imported" | "skipped" | { error: string };

async function insertProduct(row: ImportRow & { position: number }): Promise<InsertOutcome> {
  const payload = {
    ...row,
    images: row.images as unknown as Json,
    options: row.options as unknown as Json,
    variants: row.variants as unknown as Json,
  };
  let { error } = await supabase.from("products").insert(payload);
  // Same fallback as ProductForm: the "position" column only exists once its
  // migration has run. Only retry for that error, so a transient failure can't
  // insert the product with position 0 (the top of the grid).
  if (error && /position/i.test(error.message)) {
    const { position: _position, ...withoutPosition } = payload;
    ({ error } = await supabase.from("products").insert(withoutPosition));
  }
  // Unique violation on handle: it appeared in the store since the preview
  // loaded. Existing products are never overwritten.
  if (error?.code === "23505") return "skipped";
  if (error) return { error: error.message };
  return "imported";
}

interface Summary {
  imported: number;
  skipped: number;
  failed: Array<{ title: string; error: string }>;
  imagesNotCopied: number;
  /** Storage's message for the first image that couldn't be copied. */
  imageError: string | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview" }
  | { kind: "importing"; done: number; total: number; current: string }
  | { kind: "done"; summary: Summary };

interface ShopifyImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

const ShopifyImportDialog = ({ open, onOpenChange, onImported }: ShopifyImportDialogProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nextPosition, setNextPosition] = useState(1);
  const [staged, setStaged] = useState<Map<string, StagedCopy>>(new Map());
  const [media, setMedia] = useState<MediaMap>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    Promise.all([loadRecoveredCatalogue(), loadExistingProducts()])
      .then(([catalogue, existing]) => {
        if (cancelled) return;
        setStaged(catalogue.staged);
        setMedia(catalogue.media);
        const plan = planImport(catalogue.nodes, existing, SHOPIFY_HANDLE_ORDER);
        // Same rule as the Products tab: append after the current grid.
        setNextPosition(existing.length ? Math.max(...existing.map((p) => p.position ?? 0)) + 1 : 1);
        setCandidates(plan);
        setSelected(new Set(plan.filter((c) => c.selectedByDefault).map((c) => c.row.handle)));
        setPhase({ kind: "preview" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const importable = useMemo(() => candidates.filter((c) => c.status !== "exists"), [candidates]);
  const alreadyIn = candidates.length - importable.length;

  const toggle = (handle: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(handle);
      else next.delete(handle);
      return next;
    });

  const runImport = async () => {
    const chosen = candidates.filter((c) => c.status !== "exists" && selected.has(c.row.handle)).map((c) => c.row);
    const rows = withPositions(chosen, nextPosition);
    const summary: Summary = { imported: 0, skipped: 0, failed: [], imagesNotCopied: 0, imageError: null };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setPhase({ kind: "importing", done: i, total: rows.length, current: row.title });
      const copies = await Promise.all(row.images.map((img, idx) => copyImage(img.url, row.handle, idx, staged)));
      summary.imagesNotCopied += copies.filter((c) => c.error).length;
      summary.imageError ??= copies.find((c) => c.error)?.error ?? null;
      const images = row.images.map((img, idx) => ({ ...img, url: copies[idx].url, ...(copies[idx].thumb ? { thumb: copies[idx].thumb } : {}) }));

      const outcome = await insertProduct({ ...row, images, description_html: rewriteDescription(row.description_html, media, BASE) });
      if (outcome === "imported") summary.imported++;
      else if (outcome === "skipped") summary.skipped++;
      else summary.failed.push({ title: row.title, error: outcome.error });
    }

    setPhase({ kind: "done", summary });
    onImported();
  };

  const busy = phase.kind === "importing";
  const selectedCount = importable.filter((c) => selected.has(c.row.handle)).length;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={`max-w-2xl max-h-[90vh] overflow-y-auto ${PHONE_SHEET}`} onOpenAutoFocus={keepKeyboardClosed}>
        <DialogHeader>
          <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">Restore old products</DialogTitle>
        </DialogHeader>

        {phase.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="font-body text-[11px] text-muted-foreground">Loading your recovered catalogue…</p>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="py-8 space-y-3">
            <p className="font-body text-[12px]">The import couldn't start. Nothing was changed.</p>
            <p className="font-body text-[11px] text-muted-foreground">{phase.message}</p>
          </div>
        )}

        {phase.kind === "preview" && (
          <div className="space-y-4">
            <p className="font-body text-[11px] text-muted-foreground">
              {candidates.length} product{candidates.length !== 1 ? "s" : ""} recovered from archived copies of your old
              Shopify store (February 2025 to April 2026)
              {alreadyIn > 0 && ` · ${alreadyIn} already in your store (left untouched)`}. Your current products stay
              exactly as they are; restored ones are added after them, in the old storefront's order, with their
              original numbers and product links. Items that weren't on your old storefront (mostly ones that had left
              the store before it closed) start unticked.
            </p>

            {importable.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[11px]"
                  onClick={() => setSelected(new Set(importable.map((c) => c.row.handle)))}
                >
                  Select all
                </Button>
                <Button variant="outline" size="sm" className="text-[11px]" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            <ul className="border border-border rounded-md divide-y divide-border">
              {candidates.map((c) => {
                const disabled = c.status === "exists";
                const id = `import-${c.row.handle}`;
                return (
                  <li key={c.row.handle} className={`flex items-start gap-3 p-2 ${disabled ? "opacity-50" : ""}`}>
                    <Checkbox
                      id={id}
                      className="mt-3"
                      checked={!disabled && selected.has(c.row.handle)}
                      disabled={disabled}
                      onCheckedChange={(v) => toggle(c.row.handle, v === true)}
                    />
                    <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                      {c.row.images[0] && (
                        <img
                          src={staged.get(c.row.images[0].url)?.thumb ?? c.row.images[0].url}
                          alt=""
                          className="max-w-full max-h-full object-contain"
                        />
                      )}
                    </div>
                    <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
                      <div className="font-body text-[12px] truncate">
                        <span className="text-muted-foreground mr-1.5">{String(c.row.sort_order).padStart(3, "0")}</span>
                        {c.row.title}
                      </div>
                      <div className="font-body text-[10px] text-muted-foreground">
                        {c.row.currency} {c.row.price.toFixed(0)}
                        {c.row.variants.length > 0 && ` · ${c.row.variants.length} variants`}
                        {` · ${c.row.images.length} image${c.row.images.length !== 1 ? "s" : ""}`}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.status === "exists" && (
                          <Badge variant="secondary" className="text-[10px]">Already in store</Badge>
                        )}
                        {c.status === "title-match" && (
                          <Badge variant="outline" className="text-[10px]">Similar title already in store</Badge>
                        )}
                        {!c.onOldStorefront && (
                          <Badge variant="outline" className="text-[10px]">Not on your old storefront</Badge>
                        )}
                        {!c.row.available && <Badge variant="outline" className="text-[10px]">Sold out</Badge>}
                      </div>
                      {c.note && <div className="font-body text-[10px] text-muted-foreground mt-1">⚠ {c.note}</div>}
                      {c.numberTakenBy && (
                        <div className="font-body text-[10px] text-muted-foreground mt-1">
                          Number {String(c.row.sort_order).padStart(3, "0")} is also used by “{c.numberTakenBy}”
                        </div>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={runImport} disabled={selectedCount === 0}>
                Import {selectedCount} product{selectedCount !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {phase.kind === "importing" && (
          <div className="py-8 space-y-3">
            <Progress value={(phase.done / Math.max(1, phase.total)) * 100} />
            <p className="font-body text-[11px] text-muted-foreground">
              Importing {phase.done + 1} of {phase.total}: {phase.current}
            </p>
            <p className="font-body text-[10px] text-muted-foreground">
              Copying images into your own storage. Keep this window open.
            </p>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="py-4 space-y-3">
            <p className="font-body text-[12px]">
              Imported {phase.summary.imported} product{phase.summary.imported !== 1 ? "s" : ""}.
            </p>
            {phase.summary.skipped > 0 && (
              <p className="font-body text-[11px] text-muted-foreground">
                {phase.summary.skipped} skipped because they were already in your store.
              </p>
            )}
            {phase.summary.imagesNotCopied > 0 && (
              <p className="font-body text-[11px] text-muted-foreground">
                {phase.summary.imagesNotCopied} image{phase.summary.imagesNotCopied !== 1 ? "s" : ""} couldn't be
                copied into your storage, so for now they load from the backup copies on this site.
                {phase.summary.imageError && ` Storage said: “${phase.summary.imageError}”.`}
              </p>
            )}
            {phase.summary.failed.length > 0 && (
              <div className="space-y-1">
                <p className="font-body text-[11px]">{phase.summary.failed.length} failed:</p>
                <ul className="font-body text-[11px] text-muted-foreground list-disc pl-4">
                  {phase.summary.failed.map((f) => (
                    <li key={f.title}>
                      {f.title}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShopifyImportDialog;
