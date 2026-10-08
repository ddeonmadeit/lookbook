import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import type { ManualImage, ManualOption, ManualVariant } from "@/lib/products";
import {
  type MediaMap,
  type PhotoMap,
  type PlannedPhoto,
  planPhotoUpdates,
  rewriteDescription,
  withReplacedImages,
} from "@/lib/photoUpdates";
import { type RevisionPart, type RevisionPatch, type Revisions, planRevision, revisionParts } from "@/lib/recoveredRevisions";
import { type ShopifyImportNode, toImportRow } from "@/lib/shopifyImport";
import { optimizeImage } from "@/lib/optimizeImage";
import { downloadImage, storeOptimisedPhoto } from "@/lib/storeImage";
import { PHONE_SHEET, keepKeyboardClosed } from "./phoneSheet";

const BASE = import.meta.env.BASE_URL;

interface Target {
  id: string;
  handle: string;
  title: string;
  /** Its photos, already switched to the newer version's where that applies. */
  images: ManualImage[];
  planned: PlannedPhoto[];
  /** Other fields to save: a newer version's details and/or self-hosted description media. */
  fields: RevisionPatch;
  /** Description links switch to self-hosted media. */
  descriptionMedia: boolean;
  /** What the newer version from the old store brings, if any of it applies. */
  revision: { note: string; kept: RevisionPart[] } | null;
}

const PART_NAMES: Record<RevisionPart, string> = { photos: "photos", description: "description", sizes: "sizes", weight: "shipping weight" };

/** Every product with something to optimise or bring up to date, read fresh from the database. */
async function loadTargets(): Promise<Target[]> {
  const [{ photos, media }, revisions, catalogue] = await Promise.all([
    import("@/data/photoOptimisations.json").then((m) => m.default as { photos: PhotoMap; media: MediaMap }),
    import("@/data/recoveredRevisions.json").then((m) => m.default as unknown as Revisions),
    import("@/data/recoveredShopifyCatalogue.json").then((m) => m.default as unknown as ShopifyImportNode[]),
  ]);
  const { data, error } = await supabase
    .from("products")
    .select("id, handle, title, images, description_html, options, variants, weight_grams, sort_order");
  if (error) throw new Error(`Couldn't read your products: ${error.message}`);
  type Row = {
    id: string;
    handle: string;
    title: string;
    images: ManualImage[] | null;
    description_html: string | null;
    options: ManualOption[] | null;
    variants: ManualVariant[] | null;
    weight_grams: number;
    sort_order: number;
  };
  return ((data ?? []) as unknown as Row[])
    .map((p) => {
      const row = { ...p, images: p.images ?? [], options: p.options ?? [], variants: p.variants ?? [] };
      const revision = revisions[p.handle];
      const node = revision && catalogue.find((n) => n.handle === p.handle);
      const { patch, applied } = node
        ? planRevision(row, revision, toImportRow(node, p.sort_order))
        : { patch: {}, applied: [] };
      const fields: RevisionPatch = { ...patch };
      const images = patch.images ?? row.images;
      const description = patch.description_html !== undefined ? patch.description_html : p.description_html;
      const rewritten = rewriteDescription(description, media, BASE);
      if (rewritten !== description) fields.description_html = rewritten;
      return {
        id: p.id,
        handle: p.handle,
        title: p.title,
        images,
        planned: planPhotoUpdates(images, photos, BASE),
        fields,
        descriptionMedia: rewritten !== description,
        revision:
          applied.length > 0 ? { note: revision.note, kept: revisionParts(revision).filter((part) => !applied.includes(part)) } : null,
      };
    })
    .filter((t) => t.planned.length > 0 || Object.keys(t.fields).length > 0);
}

/** A photo's optimised pair, from its staged copy or by optimising it here. */
async function optimisedPair(p: PlannedPhoto) {
  if (p.kind === "staged") {
    const [full, thumb] = await Promise.all([downloadImage(p.full, false), downloadImage(p.thumb, false)]);
    return { full, thumb, fallbackType: p.fallbackType };
  }
  return optimizeImage(await downloadImage(p.source, false));
}

interface Summary {
  products: number;
  photos: number;
  descriptions: number;
  revised: number;
  failed: Array<{ title: string; error: string }>;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview" }
  | { kind: "working"; done: number; total: number; current: string }
  | { kind: "done"; summary: Summary };

// Photos processed at once; keeps a phone connection responsive.
const PARALLEL = 3;

interface OptimisePhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

const OptimisePhotosDialog = ({ open, onOpenChange, onUpdated }: OptimisePhotosDialogProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [targets, setTargets] = useState<Target[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    loadTargets()
      .then((t) => {
        if (cancelled) return;
        setTargets(t);
        setPhase({ kind: "preview" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const photos = targets.reduce((n, t) => n + t.planned.length, 0);
  const cutouts = targets.reduce((n, t) => n + t.planned.filter((p) => p.kind === "staged" && p.cutout).length, 0);
  const descriptions = targets.filter((t) => t.descriptionMedia).length;
  const revised = targets.filter((t) => t.revision !== null);

  const run = async () => {
    const summary: Summary = { products: 0, photos: 0, descriptions: 0, revised: 0, failed: [] };
    let done = 0;
    for (const t of targets) {
      const replaced = new Map<number, { url: string; thumb: string }>();
      let firstError: string | null = null;
      for (let i = 0; i < t.planned.length; i += PARALLEL) {
        setPhase({ kind: "working", done, total: photos, current: t.title });
        await Promise.all(
          t.planned.slice(i, i + PARALLEL).map(async (p) => {
            try {
              const pair = await optimisedPair(p);
              replaced.set(p.index, await storeOptimisedPhoto(pair.full, pair.thumb, t.handle, p.index, pair.fallbackType));
            } catch (err) {
              firstError ??= err instanceof Error ? err.message : String(err);
            } finally {
              done++;
            }
          }),
        );
      }
      // A newer version's photos are saved even if some uploads failed: they're
      // still the right photos, and running this again finishes moving them.
      const update = { ...t.fields } as unknown as TablesUpdate<"products">;
      if (replaced.size > 0 || t.fields.images) update.images = withReplacedImages(t.images, replaced) as unknown as Json;
      if (Object.keys(update).length > 0) {
        const { error } = await supabase.from("products").update(update).eq("id", t.id);
        if (error) {
          summary.failed.push({ title: t.title, error: `couldn't save the product: ${error.message}` });
          continue;
        }
        summary.products++;
        summary.photos += replaced.size;
        if (t.descriptionMedia) summary.descriptions++;
        if (t.revision !== null) summary.revised++;
      }
      if (firstError) summary.failed.push({ title: t.title, error: `${t.planned.length - replaced.size} photo(s) not updated: ${firstError}` });
    }
    setPhase({ kind: "done", summary });
    onUpdated();
  };

  const busy = phase.kind === "working";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={`max-w-2xl max-h-[90vh] overflow-y-auto ${PHONE_SHEET}`} onOpenAutoFocus={keepKeyboardClosed}>
        <DialogHeader>
          <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">Optimise product photos</DialogTitle>
        </DialogHeader>

        {phase.kind === "loading" && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {phase.kind === "error" && (
          <div className="py-8 space-y-3">
            <p className="font-body text-[12px]">Couldn't start. Nothing was changed.</p>
            <p className="font-body text-[11px] text-muted-foreground">{phase.message}</p>
          </div>
        )}

        {phase.kind === "preview" && targets.length === 0 && (
          <p className="font-body text-[12px] py-8">Every product photo is already in your storage and optimised.</p>
        )}

        {phase.kind === "preview" && targets.length > 0 && (
          <div className="space-y-4">
            <p className="font-body text-[11px] text-muted-foreground">
              Moves {photos} photo{photos !== 1 ? "s" : ""} on {targets.length} product{targets.length !== 1 ? "s" : ""} into
              your own storage as fast-loading WebP with a small copy for the grid, instead of the multi-megabyte
              originals (some still on Shopify's servers).
              {cutouts > 0 && ` ${cutouts} product shots get their backgrounds removed to match your current products.`}
              {descriptions > 0 &&
                ` ${descriptions} description${descriptions !== 1 ? "s" : ""} link to videos or a size chart on Shopify; those switch to copies on your own site.`}
              {revised.length > 0 &&
                ` ${revised.length} restored product${revised.length !== 1 ? "s" : ""} also switch to the newer version from your last Shopify store, which the first restore missed.`}{" "}
              Anything you've changed since restoring isn't touched.
            </p>
            <ul className="border border-border rounded-md divide-y divide-border">
              {targets.map((t) => {
                const firstStaged = t.planned.find((p) => p.kind === "staged");
                const n = t.planned.filter((p) => p.kind === "staged" && p.cutout).length;
                return (
                  <li key={t.id} className="flex items-center gap-3 p-2">
                    <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                      {firstStaged?.kind === "staged" && <img src={firstStaged.thumb} alt="" className="max-w-full max-h-full object-contain" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-body text-[12px] truncate">{t.title}</div>
                      <div className="font-body text-[10px] text-muted-foreground">
                        {t.planned.length} photo{t.planned.length !== 1 ? "s" : ""}
                        {n > 0 && ` · ${n} background${n !== 1 ? "s" : ""} removed`}
                        {t.descriptionMedia && " · description media"}
                      </div>
                      {t.revision && (
                        <div className="font-body text-[10px]">
                          Newer version: {t.revision.note}
                          {t.revision.kept.length > 0 &&
                            ` · keeps your own ${t.revision.kept.map((part) => PART_NAMES[part]).join(" and ")}, changed after restoring`}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={run}>
                {photos > 0 ? `Optimise ${photos} photos` : "Update products"}
              </Button>
            </div>
          </div>
        )}

        {phase.kind === "working" && (
          <div className="py-8 space-y-3">
            <Progress value={(phase.done / Math.max(1, phase.total)) * 100} />
            <p className="font-body text-[11px] text-muted-foreground">
              {phase.done} of {phase.total} photos · {phase.current}
            </p>
            <p className="font-body text-[10px] text-muted-foreground">Keep this window open.</p>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="py-4 space-y-3">
            <p className="font-body text-[12px]">
              Updated {phase.summary.products} product{phase.summary.products !== 1 ? "s" : ""}: {phase.summary.photos} photo
              {phase.summary.photos !== 1 ? "s" : ""} optimised
              {phase.summary.descriptions > 0 &&
                `, ${phase.summary.descriptions} description${phase.summary.descriptions !== 1 ? "s" : ""} switched to self-hosted media`}
              {phase.summary.revised > 0 &&
                `, ${phase.summary.revised} brought up to the newer version from your last Shopify store`}
              .
            </p>
            {phase.summary.failed.length > 0 && (
              <div className="space-y-1">
                <p className="font-body text-[11px]">Not everything went through; run it again to retry the rest:</p>
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

export default OptimisePhotosDialog;
