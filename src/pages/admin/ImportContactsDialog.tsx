import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileUp, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  type ContactInput,
  type ContactLayout,
  type ImportTally,
  countPeople,
  isMissingContactsSetup,
  parseCsv,
  rowsToPeople,
} from "@/lib/contacts";
import ContactsSetup from "./ContactsSetup";
import { PHONE_SHEET, keepKeyboardClosed } from "./phoneSheet";

// The generated database types predate the contacts table.
const db = supabase as unknown as SupabaseClient;

interface Picked {
  name: string;
  layout?: ContactLayout;
  people: ContactInput[];
  /** Why this file can't be used. */
  problem?: string;
}

type Phase =
  | { kind: "pick" }
  | { kind: "importing"; done: number; total: number }
  | { kind: "done"; tally: ImportTally }
  | { kind: "setup" }
  | { kind: "error"; message: string };

// People per request: small enough for a phone connection, large enough to be quick.
const CHUNK = 200;

/** Where these people came from, as shown on each contact. */
function sourceFor(p: Picked): string | null {
  if (p.layout === "merged list") return null; // carries its own sources
  if (/klaviyo/i.test(p.name)) return "klaviyo";
  if (p.layout === "Shopify export") return "shopify";
  return "imported list";
}

function read(name: string, text: string): Picked {
  const table = parseCsv(text);
  if (table.length < 2) return { name, people: [], problem: "No rows found — the first row should be the column names." };
  const { people, layout } = rowsToPeople(table);
  if (countPeople(people).people === 0) {
    return { name, people: [], layout, problem: "No email or phone column found in this file." };
  }
  return { name, people, layout };
}

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

/**
 * Bring contact lists in (Shopify/Klaviyo exports, the merged list, any
 * spreadsheet saved as CSV). The database merges each person into whoever
 * they already are, so importing overlapping lists — or the same list twice —
 * never creates a duplicate.
 */
const ImportContactsDialog = ({ open, onOpenChange, onImported }: ImportContactsDialogProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [picked, setPicked] = useState<Picked[]>([]);
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    if (open) {
      setPhase({ kind: "pick" });
      setPicked([]);
      setPasted("");
    }
  }, [open]);

  const addFiles = async (files: FileList | null) => {
    const next: Picked[] = [];
    for (const f of Array.from(files ?? [])) {
      if (/\.(xlsx?|numbers)$/i.test(f.name)) {
        next.push({ name: f.name, people: [], problem: "Spreadsheet files can't be read here — save it as CSV first." });
        continue;
      }
      next.push(read(f.name, await f.text()));
    }
    setPicked((prev) => [...prev.filter((p) => !next.some((n) => n.name === p.name)), ...next]);
  };

  const usable = [...picked.filter((p) => !p.problem), ...(pasted.trim() ? [read("Pasted list", pasted)] : [])].filter(
    (p) => !p.problem,
  );
  const allPeople = usable.flatMap((p) => p.people);
  const preview = countPeople(allPeople);
  const pastedProblem = pasted.trim() ? read("Pasted list", pasted).problem : undefined;

  const run = async () => {
    const tally: ImportTally = { added: 0, updated: 0, merged: 0, unchanged: 0, skipped: 0 };
    const total = allPeople.length;
    let done = 0;
    setPhase({ kind: "importing", done, total });
    for (const file of usable) {
      for (let i = 0; i < file.people.length; i += CHUNK) {
        const chunk = file.people.slice(i, i + CHUNK);
        const { data, error } = await db.rpc("import_contacts", { people: chunk, source: sourceFor(file) });
        if (error) {
          if (isMissingContactsSetup(error)) {
            setPhase({ kind: "setup" });
            return;
          }
          // Whatever went in before this stays in (each batch is all-or-nothing).
          setPhase({ kind: "error", message: `${error.message}${done ? ` (${done} of ${total} rows were imported first)` : ""}` });
          onImported();
          return;
        }
        for (const k of Object.keys(tally) as Array<keyof ImportTally>) tally[k] += Number((data as ImportTally)?.[k] ?? 0);
        done += chunk.length;
        setPhase({ kind: "importing", done, total });
      }
    }
    setPhase({ kind: "done", tally });
    onImported();
  };

  const busy = phase.kind === "importing";
  const label = "font-body text-[10px] uppercase tracking-[0.12em] text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={`max-w-lg max-h-[90vh] overflow-y-auto ${PHONE_SHEET}`} onOpenAutoFocus={keepKeyboardClosed}>
        <DialogHeader>
          <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">Import contacts</DialogTitle>
        </DialogHeader>

        {phase.kind === "pick" && (
          <div className="space-y-4">
            <p className="font-body text-[12px] text-muted-foreground leading-relaxed">
              Choose one or more CSV files — a Shopify or Klaviyo export, or any list with email or phone columns.
              Everyone is matched by email, phone number and name: people already in your contacts are updated, never
              added twice.
            </p>
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-border rounded-md py-6 cursor-pointer active:bg-muted">
              <FileUp className="w-6 h-6 text-muted-foreground" />
              <span className="font-body text-[13px]">Choose files</span>
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>

            {picked.length > 0 && (
              <ul className="border border-border rounded-md divide-y divide-border">
                {picked.map((p) => (
                  <li key={p.name} className="px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-body text-[12px] truncate">{p.name}</p>
                      <p className={`font-body text-[11px] ${p.problem ? "text-destructive" : "text-muted-foreground"}`}>
                        {p.problem ?? `${p.layout} · ${p.people.length} row${p.people.length === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="font-body text-[11px] text-muted-foreground underline flex-shrink-0 py-1"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.name !== p.name))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <details className="group">
              <summary className="font-body text-[12px] text-muted-foreground cursor-pointer select-none py-1">
                Or paste a list
              </summary>
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={5}
                placeholder={"Name,Email,Phone\nJordan Lee,jordan@example.com,0412 345 678"}
                className="mt-2 font-mono text-[12px]"
              />
              {pastedProblem && <p className="font-body text-[11px] text-destructive mt-1">{pastedProblem}</p>}
            </details>

            {allPeople.length > 0 && (
              <div className="border border-border rounded-md p-3">
                <p className={label}>Ready to import</p>
                <p className="font-body text-[13px] mt-1">
                  {allPeople.length} row{allPeople.length === 1 ? "" : "s"} · about {preview.people} different{" "}
                  {preview.people === 1 ? "person" : "people"}
                </p>
                {preview.withoutDetails > 0 && (
                  <p className="font-body text-[11px] text-muted-foreground mt-0.5">
                    {preview.withoutDetails} row{preview.withoutDetails === 1 ? " has" : "s have"} no email or phone and
                    will be skipped.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="max-sm:h-11">
                Cancel
              </Button>
              <Button onClick={run} disabled={allPeople.length === 0} className="max-sm:h-11 max-sm:flex-1">
                Import {allPeople.length > 0 ? `${preview.people} ${preview.people === 1 ? "person" : "people"}` : ""}
              </Button>
            </div>
          </div>
        )}

        {phase.kind === "importing" && (
          <div className="py-8 space-y-3">
            <Progress value={(phase.done / Math.max(1, phase.total)) * 100} />
            <p className="font-body text-[12px] text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Merging {phase.done} of {phase.total} rows…
            </p>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="py-2 space-y-4">
            <p className="font-body text-[14px]">
              {phase.tally.added} new contact{phase.tally.added === 1 ? "" : "s"} added.
            </p>
            <ul className="font-body text-[12px] text-muted-foreground space-y-1">
              {phase.tally.updated > 0 && <li>{phase.tally.updated} already there, now with more details</li>}
              {phase.tally.merged > 0 && <li>{phase.tally.merged} turned out to be the same person and were joined up</li>}
              {phase.tally.unchanged > 0 && <li>{phase.tally.unchanged} already there with the same details</li>}
              {phase.tally.skipped > 0 && <li>{phase.tally.skipped} skipped (no email or phone)</li>}
            </ul>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)} className="max-sm:h-11 max-sm:w-full">
                Done
              </Button>
            </div>
          </div>
        )}

        {phase.kind === "setup" && <ContactsSetup onReady={() => setPhase({ kind: "pick" })} />}

        {phase.kind === "error" && (
          <div className="py-4 space-y-3">
            <p className="font-body text-[13px]">The import stopped.</p>
            <p className="font-body text-[12px] text-muted-foreground">{phase.message}</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setPhase({ kind: "pick" })} className="max-sm:h-11">
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ImportContactsDialog;
