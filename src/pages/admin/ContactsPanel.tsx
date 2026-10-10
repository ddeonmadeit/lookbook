import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type ContactRow, contactsToCsv, formatPhone, isMissingContactsSetup } from "@/lib/contacts";
import ContactsSetup from "./ContactsSetup";
import ImportContactsDialog from "./ImportContactsDialog";

// The generated database types predate the contacts table.
const db = supabase as unknown as SupabaseClient;

const SOURCE_LABELS: Record<string, string> = {
  shopify: "Shopify",
  klaviyo: "Klaviyo",
  "customer list": "Customer list",
  "email list": "Email list",
  "phone list": "Phone list",
  "imported list": "Imported list",
  "early access": "Early access",
  "restock request": "Restock request",
  order: "Ordered here",
};

const PAGE = 60;

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Everyone the store can reach, one row per person: imported old customers,
 * early-access sign-ups, restock requests and buyers, merged by the database
 * so nobody appears twice.
 */
const ContactsPanel = ({ fallback }: { fallback?: ReactNode }) => {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db
      .from("contacts")
      .select("*")
      .order("name", { ascending: true, nullsFirst: false })
      .order("email", { ascending: true, nullsFirst: false })
      .range(0, 9999);
    if (error) {
      if (isMissingContactsSetup(error)) setReady(false);
      else {
        toast.error("Failed to load contacts", { description: error.message });
        setReady(true);
      }
      return;
    }
    setContacts((data as ContactRow[]) ?? []);
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    const qd = digits(q);
    return contacts.filter((c) => {
      const text = [c.name, c.email, ...c.other_emails, c.city, c.state, c.location, c.postcode, c.tags, c.note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (text.includes(q)) return true;
      // numbers match however they're typed: "0412 345", "412345", "+61412…"
      if (qd.length >= 3) {
        const local = qd.replace(/^0/, "");
        return [c.phone, ...c.other_phones].some((p) => p && (digits(p).includes(qd) || digits(p).includes(local)));
      }
      return false;
    });
  }, [contacts, search]);

  const stats = useMemo(
    () => ({
      email: contacts.filter((c) => c.email).length,
      phone: contacts.filter((c) => c.phone).length,
      emailOk: contacts.filter((c) => c.email_consent).length,
      smsOk: contacts.filter((c) => c.sms_consent).length,
    }),
    [contacts],
  );

  const exportCsv = () => {
    const blob = new Blob([contactsToCsv(visible)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knots-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (ready === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="space-y-5">
        <ContactsSetup onReady={load} />
        {fallback}
      </div>
    );
  }

  const stat = "font-body text-[10px] uppercase tracking-[0.12em] text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Contacts", value: contacts.length },
          { label: "With email", value: stats.email },
          { label: "With phone", value: stats.phone },
          { label: "OK to market", value: `${stats.emailOk} email · ${stats.smsOk} SMS` },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-md p-3">
            <p className={stat}>{s.label}</p>
            <p className="font-body text-[15px] mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <Input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search name, email, phone, suburb…"
          className="h-9 max-sm:h-11 flex-1 min-w-0 text-[12px] max-sm:text-[15px]"
        />
        <Button size="sm" onClick={() => setImportOpen(true)} className="h-9 max-sm:h-11">
          <FileUp className="w-4 h-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Import</span>
          <span className="sr-only sm:hidden">Import contacts</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportCsv}
          disabled={visible.length === 0}
          className="h-9 max-sm:h-11 max-sm:w-11 max-sm:p-0"
          aria-label="Export contacts CSV"
        >
          <Download className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {contacts.length === 0 ? (
        <div className="border border-dashed border-border rounded-md p-6 text-center space-y-3">
          <p className="font-body text-[13px]">No contacts yet.</p>
          <p className="font-body text-[12px] text-muted-foreground">
            Import your old customer lists — they're merged so nobody is listed twice. New sign-ups and buyers are added
            automatically.
          </p>
          <Button onClick={() => setImportOpen(true)} className="max-sm:h-11">
            <FileUp className="w-4 h-4 mr-1.5" /> Import contacts
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-8 text-center">No contacts match that search.</p>
      ) : (
        <ul className="-mx-4 sm:mx-0 border-y sm:border sm:rounded-md border-border divide-y divide-border">
          {visible.slice(0, limit).map((c) => {
            const open = expanded === c.id;
            const title = c.name || c.email || formatPhone(c.phone);
            const place = [c.city, c.state, c.country].filter(Boolean).join(", ") || c.location;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : c.id)}
                  aria-expanded={open}
                  className="w-full text-left px-4 py-3 flex items-start gap-2 active:bg-muted transition-colors"
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-body text-[13px] max-sm:text-[14px] truncate">{title}</span>
                    <span className="block font-body text-[11px] max-sm:text-[12px] text-muted-foreground truncate">
                      {[c.name ? c.email : null, c.name || c.email ? formatPhone(c.phone) : null].filter(Boolean).join(" · ") ||
                        " "}
                    </span>
                    {place && (
                      <span className="block font-body text-[11px] text-muted-foreground truncate">{place}</span>
                    )}
                  </span>
                  <span className="flex flex-col items-end gap-1 flex-shrink-0">
                    {c.email_consent && (
                      <span className="font-body text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                        Email OK
                      </span>
                    )}
                    {c.sms_consent && (
                      <span className="font-body text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                        SMS OK
                      </span>
                    )}
                  </span>
                </button>

                {open && (
                  <div className="px-4 pb-4 pl-10 space-y-3">
                    <div className="space-y-1">
                      {[c.email, ...c.other_emails].filter(Boolean).map((e) => (
                        <a key={e} href={`mailto:${e}`} className="block font-body text-[13px] underline-offset-2 hover:underline py-0.5">
                          {e}
                        </a>
                      ))}
                      {[c.phone, ...c.other_phones].filter(Boolean).map((p) => (
                        <a key={p} href={`tel:${p}`} className="block font-body text-[13px] underline-offset-2 hover:underline py-0.5">
                          {formatPhone(p)}
                        </a>
                      ))}
                    </div>
                    {(c.address || c.postcode) && (
                      <div>
                        <p className={stat}>Address</p>
                        <p className="font-body text-[12px] mt-0.5">
                          {[c.address, c.city, c.state, c.postcode, c.country].filter(Boolean).join(", ")}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className={stat}>Marketing email</p>
                        <p className="font-body text-[12px] mt-0.5">
                          {c.email_consent === true ? "Agreed" : c.email_consent === false ? "Not agreed" : "Unknown"}
                        </p>
                      </div>
                      <div>
                        <p className={stat}>Marketing texts</p>
                        <p className="font-body text-[12px] mt-0.5">
                          {c.sms_consent === true ? "Agreed" : c.sms_consent === false ? "Not agreed" : "Unknown"}
                        </p>
                      </div>
                    </div>
                    {(c.shopify_orders ?? 0) > 0 && (
                      <div>
                        <p className={stat}>Old Shopify store</p>
                        <p className="font-body text-[12px] mt-0.5">
                          {c.shopify_orders} order{c.shopify_orders === 1 ? "" : "s"} · ${Number(c.shopify_spent ?? 0).toFixed(2)}
                        </p>
                      </div>
                    )}
                    {c.note && (
                      <div>
                        <p className={stat}>Note</p>
                        <p className="font-body text-[12px] mt-0.5 whitespace-pre-wrap">{c.note}</p>
                      </div>
                    )}
                    <p className="font-body text-[11px] text-muted-foreground">
                      From {c.sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ") || "—"}
                      {c.tags ? ` · ${c.tags}` : ""}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((n) => n + PAGE * 3)} className="max-sm:h-11 max-sm:w-full">
            Show more ({visible.length - limit} left)
          </Button>
        </div>
      )}

      <ImportContactsDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
    </div>
  );
};

export default ContactsPanel;
