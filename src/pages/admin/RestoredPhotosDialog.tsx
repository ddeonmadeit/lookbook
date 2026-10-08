import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ManualImage } from "@/lib/products";
import { type PhotoManifest, type PlannedPhoto, planPhotoUpdates, withReplacedImages } from "@/lib/photoUpdates";
import { downloadImage, storeProductImage } from "@/lib/storeImage";

interface Target {
  id: string;
  handle: string;
  title: string;
  images: ManualImage[];
  planned: PlannedPhoto[];
}

/** Restored products that still have photos to update, read fresh from the database. */
async function loadTargets(): Promise<Target[]> {
  const manifest = (await import("@/data/restoredPhotoUpdates.json")).default as PhotoManifest;
  const { data, error } = await supabase.from("products").select("id, handle, title, images").in("handle", Object.keys(manifest));
  if (error) throw new Error(`Couldn't read your products: ${error.message}`);
  return ((data ?? []) as unknown as Omit<Target, "planned">[])
    .map((p) => ({ ...p, images: p.images ?? [], planned: planPhotoUpdates(p.images ?? [], manifest[p.handle], import.meta.env.BASE_URL) }))
    .filter((p) => p.planned.length > 0);
}

interface Summary {
  products: number;
  cutouts: number;
  copied: number;
  failed: Array<{ title: string; error: string }>;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview" }
  | { kind: "working"; done: number; total: number; current: string }
  | { kind: "done"; summary: Summary };

// Photos uploaded at the same time; keeps a phone connection responsive.
const PARALLEL = 3;

interface RestoredPhotosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

const RestoredPhotosDialog = ({ open, onOpenChange, onUpdated }: RestoredPhotosDialogProps) => {
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

  const cutouts = targets.reduce((n, t) => n + t.planned.filter((p) => p.kind === "cutout").length, 0);
  const copies = targets.reduce((n, t) => n + t.planned.filter((p) => p.kind === "copy").length, 0);

  const run = async () => {
    const total = cutouts + copies;
    const summary: Summary = { products: 0, cutouts: 0, copied: 0, failed: [] };
    let done = 0;
    for (const t of targets) {
      const replaced = new Map<number, string>();
      let firstError: string | null = null;
      for (let i = 0; i < t.planned.length; i += PARALLEL) {
        setPhase({ kind: "working", done, total, current: t.title });
        await Promise.all(
          t.planned.slice(i, i + PARALLEL).map(async (p) => {
            try {
              const blob = await downloadImage(p.source, p.kind === "copy");
              replaced.set(p.index, await storeProductImage(blob, t.handle, p.index, p.fallbackType));
              if (p.kind === "cutout") summary.cutouts++;
              else summary.copied++;
            } catch (err) {
              firstError ??= err instanceof Error ? err.message : String(err);
            } finally {
              done++;
            }
          }),
        );
      }
      if (replaced.size > 0) {
        const { error } = await supabase
          .from("products")
          .update({ images: withReplacedImages(t.images, replaced) as unknown as Json })
          .eq("id", t.id);
        if (error) {
          summary.failed.push({ title: t.title, error: `photos uploaded but the product couldn't be updated: ${error.message}` });
          continue;
        }
        summary.products++;
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
          <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">Update old product photos</DialogTitle>
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
          <p className="font-body text-[12px] py-8">All of the restored products' photos are already up to date.</p>
        )}

        {phase.kind === "preview" && targets.length > 0 && (
          <div className="space-y-4">
            <p className="font-body text-[11px] text-muted-foreground">
              {targets.length} restored product{targets.length !== 1 ? "s" : ""} still load their photos from Shopify's
              servers, which can delete them at any time. This moves them into your own storage: {cutouts} product
              shot{cutouts !== 1 ? "s" : ""} with the background removed, to match your current products, and {copies}{" "}
              campaign photo{copies !== 1 ? "s" : ""}, close-up{copies !== 1 ? "s" : ""} and size chart
              {copies !== 1 ? "s" : ""} as they are. Photos you've changed since the restore aren't touched.
            </p>
            <ul className="border border-border rounded-md divide-y divide-border">
              {targets.map((t) => {
                const first = t.planned.find((p) => p.kind === "cutout");
                const n = t.planned.filter((p) => p.kind === "cutout").length;
                return (
                  <li key={t.id} className="flex items-center gap-3 p-2">
                    {first ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <img src={t.images[first.index].url} alt="" className="w-10 h-10 object-contain" />
                        <span className="text-muted-foreground text-[10px]">→</span>
                        <img src={first.source} alt="" className="w-10 h-10 object-contain" />
                      </div>
                    ) : (
                      <img src={t.images[t.planned[0].index].url} alt="" className="w-10 h-10 object-contain flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-body text-[12px] truncate">{t.title}</div>
                      <div className="font-body text-[10px] text-muted-foreground">
                        {n > 0 && `${n} background${n !== 1 ? "s" : ""} removed · `}
                        {t.planned.length - n > 0 ? `${t.planned.length - n} kept as is` : "all product shots"}
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
                Update {cutouts + copies} photos
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
              Updated {phase.summary.products} product{phase.summary.products !== 1 ? "s" : ""}: {phase.summary.cutouts}{" "}
              background{phase.summary.cutouts !== 1 ? "s" : ""} removed, {phase.summary.copied} photo
              {phase.summary.copied !== 1 ? "s" : ""} moved as they are.
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

export default RestoredPhotosDialog;
