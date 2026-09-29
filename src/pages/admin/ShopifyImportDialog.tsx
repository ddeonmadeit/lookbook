import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { storefrontApiRequest } from "@/lib/shopify";
import { SHOPIFY_HANDLE_ORDER, type ProductRow } from "@/lib/products";
import {
  IMPORT_PRODUCTS_QUERY,
  imageExtension,
  importedImagePath,
  planImport,
  withPositions,
  type ImportCandidate,
  type ImportRow,
  type ShopifyImportNode,
} from "@/lib/shopifyImport";
import { ensureSettings, useSettingsStore } from "@/stores/settingsStore";

const PAGE_SIZE = 20;
// Safety stop for the pagination loop (1,000 products).
const MAX_PAGES = 50;

async function fetchAllShopifyProducts(): Promise<ShopifyImportNode[]> {
  await ensureSettings();
  const nodes: ShopifyImportNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await storefrontApiRequest(IMPORT_PRODUCTS_QUERY, { first: PAGE_SIZE, after }).catch((err: unknown) => {
      throw new Error(`Shopify: ${err instanceof Error ? err.message : String(err)}`);
    });
    // storefrontApiRequest returns nothing on HTTP 402 (store has no active plan).
    if (!data) throw new Error("Shopify says this store needs an active plan, so its products can't be read.");
    const conn = data.data?.products;
    if (!conn) throw new Error("Shopify returned no product list.");
    nodes.push(...conn.edges.map((e: { node: ShopifyImportNode }) => e.node));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return nodes;
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
 * Copy one Shopify image into our own storage bucket so it survives the
 * Shopify store being closed. Falls back to the Shopify URL if the copy fails.
 */
async function copyImage(url: string, handle: string, index: number): Promise<{ url: string; copied: boolean }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const ext = imageExtension(res.headers.get("content-type") || blob.type, url);
    const path = importedImagePath(handle, index, ext);
    const { error } = await supabase.storage.from("product-images").upload(path, blob, {
      cacheControl: "3600",
      upsert: true,
      contentType: blob.type || undefined,
    });
    if (error) throw error;
    return { url: supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl, copied: true };
  } catch {
    return { url, copied: false };
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
  imagesLeftOnShopify: number;
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
  const shopifyDomain = useSettingsStore((s) => s.shopifyDomain);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nextPosition, setNextPosition] = useState(1);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    Promise.all([fetchAllShopifyProducts(), loadExistingProducts()])
      .then(([nodes, existing]) => {
        if (cancelled) return;
        const plan = planImport(nodes, existing, SHOPIFY_HANDLE_ORDER);
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
    const summary: Summary = { imported: 0, skipped: 0, failed: [], imagesLeftOnShopify: 0 };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setPhase({ kind: "importing", done: i, total: rows.length, current: row.title });
      const copies = await Promise.all(row.images.map((img, idx) => copyImage(img.url, row.handle, idx)));
      summary.imagesLeftOnShopify += copies.filter((c) => !c.copied).length;
      const images = row.images.map((img, idx) => ({ ...img, url: copies[idx].url }));

      const outcome = await insertProduct({ ...row, images });
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">Import from Shopify</DialogTitle>
        </DialogHeader>

        {phase.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="font-body text-[11px] text-muted-foreground">Reading products from {shopifyDomain}…</p>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="py-8 space-y-3">
            <p className="font-body text-[12px]">The import couldn't start. Nothing was changed.</p>
            <p className="font-body text-[11px] text-muted-foreground">{phase.message}</p>
            <p className="font-body text-[11px] text-muted-foreground">
              If this is about Shopify, check the domain and storefront token under Settings ({shopifyDomain}).
            </p>
          </div>
        )}

        {phase.kind === "preview" && (
          <div className="space-y-4">
            <p className="font-body text-[11px] text-muted-foreground">
              {candidates.length} product{candidates.length !== 1 ? "s" : ""} on {shopifyDomain}
              {alreadyIn > 0 && ` · ${alreadyIn} already in your store (left untouched)`}. Your current products stay
              exactly as they are; imported ones are added after them, in the old storefront's order, with their
              original numbers and product links.
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
                        <img src={c.row.images[0].url} alt="" className="max-w-full max-h-full object-contain" />
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
                          <Badge variant="outline" className="text-[10px]">Wasn't on old storefront</Badge>
                        )}
                        {!c.row.available && <Badge variant="outline" className="text-[10px]">Sold out</Badge>}
                      </div>
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
            {phase.summary.imagesLeftOnShopify > 0 && (
              <p className="font-body text-[11px] text-muted-foreground">
                {phase.summary.imagesLeftOnShopify} image{phase.summary.imagesLeftOnShopify !== 1 ? "s" : ""} couldn't be
                copied and still load from Shopify. Re-upload them from each product's edit screen before closing
                your Shopify store.
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
