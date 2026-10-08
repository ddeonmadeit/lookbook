import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ManualImage } from "@/lib/products";
import {
  type MediaMap,
  type PhotoMap,
  type PlannedPhoto,
  planPhotoUpdates,
  rewriteDescription,
  withReplacedImages,
} from "@/lib/photoUpdates";
import { optimizeImage } from "@/lib/optimizeImage";
import { downloadImage, storeOptimisedPhoto } from "@/lib/storeImage";

const BASE = import.meta.env.BASE_URL;

interface Target {
  id: string;
  handle: string;
  title: string;
  images: ManualImage[];
  planned: PlannedPhoto[];
  /** Rewritten description when it linked to Shopify-hosted media, else null. */
  description: string | null;
}

/** Every product with something to optimise, read fresh from the database. */
async function loadTargets(): Promise<Target[]> {
  const { photos, media } = (await import("@/data/photoOptimisations.json")).default as { photos: PhotoMap; media: MediaMap };
  const { data, error } = await supabase.from("products").select("id, handle, title, images, description_html");
  if (error) throw new Error(`Couldn't read your products: ${error.message}`);
  type Row = { id: string; handle: string; title: string; images: ManualImage[] | null; description_html: string | null };
  return ((data ?? []) as unknown as Row[])
    .map((p) => {
      const rewritten = rewriteDescription(p.description_html, media, BASE);
      return {
        id: p.id,
        handle: p.handle,
        title: p.title,
        images: p.images ?? [],
        planned: planPhotoUpdates(p.images ?? [], photos, BASE),
        description: rewritten !== p.description_html ? rewritten : null,
      };
    })
    .filter((t) => t.planned.length > 0 || t.description !== null);
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
  const descriptions = targets.filter((t) => t.description !== null).length;

  const run = async () => {
    const summary: Summary = { products: 0, photos: 0, descriptions: 0, failed: [] };
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
      const update: { images?: Json; description_html?: string | null } = {};
      if (replaced.size > 0) update.images = withReplacedImages(t.images, replaced) as unknown as Json;
      if (t.description !== null) update.description_html = t.description;
      if (Object.keys(update).length > 0) {
        const { error } = await supabase.from("products").update(update).eq("id", t.id);
        if (error) {
          summary.failed.push({ title: t.title, error: `couldn't save the product: ${error.message}` });
          continue;
        }
        summary.products++;
        summary.photos += replaced.size;
        if (t.description !== null) summary.descriptions++;
      }
      if (firstError) summary.failed.push({ title: t.title, error: `${t.planned.length - replaced.size} photo(s) not updated: ${firstError}` });
    }
    setPhase({ kind: "done", summary });
    onUpdated();
  };

  const busy = phase.kind === "working";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                ` ${descriptions} description${descriptions !== 1 ? "s" : ""} link to videos or a size chart on Shopify; those switch to copies on your own site.`}{" "}
              Photos you've changed since aren't touched.
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
                        {t.description !== null && " · description media"}
                      </div>
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
                Optimise {photos} photos
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
