import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type Availability, NYE_EVENT, NYE_TIERS, TICKET_ITEMS, isSinglePrice, ticketCount, ticketRef } from "@/lib/nye";

const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0];
const LINK = "https://knotsss.com/nye";

interface TicketOrder {
  id: string;
  items: Array<{ quantity?: number; tier?: string }>;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total: number;
  currency: string;
  created_at: string;
}

/** Copies within the tap (iPhones only allow it then); falls back to showing the text. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turning ticket sales on: the nye-tickets function has to be deployed once.
 * Shown until the page can reach it.
 */
const TicketsSetup = ({ onCheck, checking, update }: { onCheck: () => void; checking: boolean; update?: boolean }) => {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    import("../../../supabase/functions/nye-tickets/index.ts?raw").then((m) => setCode(m.default));
  }, []);
  const step = "font-body text-[12px] leading-relaxed";
  return (
    <div className="border border-dashed border-border rounded-md p-3 space-y-3">
      <p className="font-body text-[12px] font-medium">
        {update ? "Update needed: the live ticket function is the old $30-only version" : "One step to switch ticket sales on"}
      </p>
      {update && (
        <p className="font-body text-[12px] text-muted-foreground leading-relaxed">
          It sells every ticket at $30. Update it to sell the first release at $20, then the second at $30. The ticket
          page shows the old $30 price until you do.
        </p>
      )}
      <ol className="list-decimal pl-5 space-y-1.5">
        <li className={step}>Tap Copy code.</li>
        {update ? (
          <li className={step}>
            Open Supabase → Edge Functions → <span className="font-mono">nye-tickets</span> →{" "}
            <span className="font-medium">Code</span>, select all the code there and paste over it, then tap Deploy.
          </li>
        ) : (
          <>
            <li className={step}>
              Open Supabase → Edge Functions → <span className="font-medium">Deploy a new function</span> →{" "}
              <span className="font-medium">Via editor</span>.
            </li>
            <li className={step}>
              Name it <span className="font-mono">nye-tickets</span>, replace all the code with what you copied, and
              tap Deploy.
            </li>
          </>
        )}
        <li className={step}>Come back and tap Check again.</li>
      </ol>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={async () => {
            if (!code) return;
            if (await copyText(code)) {
              setCopied(true);
              toast.success("Copied — now paste it in Supabase");
            } else setShow(true);
          }}
          disabled={!code}
          className="max-sm:h-11"
        >
          {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
          {copied ? "Copied" : "Copy code"}
        </Button>
        <Button variant="outline" asChild className="max-sm:h-11">
          <a href={`https://supabase.com/dashboard/project/${projectRef}/functions`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-1.5" />
            Open Supabase
          </a>
        </Button>
        <Button variant="outline" onClick={onCheck} disabled={checking} className="max-sm:h-11">
          {checking && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          Check again
        </Button>
      </div>
      {show && code && (
        <textarea
          readOnly
          value={code}
          rows={6}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full font-mono text-[11px] border border-border rounded-md p-2 bg-muted/30"
          aria-label="Function code to copy"
        />
      )}
    </div>
  );
};

/**
 * NYE ticket sales at a glance, the guest list, and door check-in (a checked-in
 * ticket is marked fulfilled). Tickets live in orders but are kept out of the
 * store's order list, since there's nothing to ship.
 */
const NyeTicketsPanel = () => {
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [live, setLive] = useState<Availability | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("id,items,status,customer_name,customer_email,customer_phone,total,currency,created_at")
      .contains("items", TICKET_ITEMS)
      .in("status", ["paid", "fulfilled", "refunded"])
      .order("created_at", { ascending: false });
    if (!error) setOrders((data as unknown as TicketOrder[]) ?? []);
  }, []);

  const checkLive = useCallback(async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("nye-tickets", { body: { action: "availability" } });
      const ok = !error && typeof (data as Availability | null)?.remaining === "number";
      setReachable(ok);
      if (ok) setLive(data as Availability);
      return ok;
    } catch {
      setReachable(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
    checkLive();
  }, [load, checkLive]);

  const valid = orders.filter((o) => o.status !== "refunded");
  const sold = valid.reduce((n, o) => n + ticketCount(o), 0);
  const inside = valid.filter((o) => o.status === "fulfilled").reduce((n, o) => n + ticketCount(o), 0);
  const revenue = valid.reduce((n, o) => n + (Number(o.total) || 0), 0);
  const capacity = live?.capacity ?? NYE_EVENT.capacity;
  // Sold per release, from the orders themselves (refunds don't count).
  const releases = (live?.tiers ?? NYE_TIERS).map((t) => ({
    ...t,
    taken: valid.reduce(
      (n, o) => n + o.items.filter((it) => (it.tier ?? NYE_TIERS[NYE_TIERS.length - 1].id) === t.id).reduce((m, it) => m + (Number(it.quantity) || 0), 0),
      0,
    ),
  }));
  const releasesOf = (o: TicketOrder) =>
    NYE_TIERS.map((t) => {
      const n = o.items.filter((it) => (it.tier ?? NYE_TIERS[NYE_TIERS.length - 1].id) === t.id).reduce((m, it) => m + (Number(it.quantity) || 0), 0);
      return n ? `${n} × ${t.name}` : "";
    })
      .filter(Boolean)
      .join(", ");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...orders].sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || ""));
    if (!q) return list;
    return list.filter((o) =>
      [o.customer_name, o.customer_email, o.customer_phone, ticketRef(o.id)].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [orders, search]);

  const toggleIn = async (o: TicketOrder) => {
    const next = o.status === "fulfilled" ? "paid" : "fulfilled";
    setBusy(o.id);
    setOrders((os) => os.map((x) => (x.id === o.id ? { ...x, status: next } : x)));
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", o.id);
    setBusy(null);
    if (error) {
      setOrders((os) => os.map((x) => (x.id === o.id ? { ...x, status: o.status } : x)));
      toast.error("Couldn't update", { description: error.message });
    }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = shown.map((o) =>
      [o.customer_name, o.customer_email, o.customer_phone, ticketCount(o), releasesOf(o), ticketRef(o.id), o.status, Number(o.total).toFixed(2)]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([["name,email,phone,tickets,releases,ref,status,paid", ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "knots-nye-guest-list.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const label = "font-body text-[10px] uppercase tracking-[0.12em] text-muted-foreground";
  return (
    <section className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-[13px] font-medium flex items-center gap-1.5">
            <Ticket className="w-4 h-4" /> NYE tickets
          </p>
          <p className="font-body text-[11px] text-muted-foreground mt-0.5">
            Unlisted page — only people with the link can find it.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-9 max-sm:h-10"
            onClick={async () => {
              if (await copyText(LINK)) toast.success("Link copied", { description: LINK });
              else toast(LINK);
            }}
          >
            <Copy className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Copy link</span>
            <span className="sr-only sm:hidden">Copy link</span>
          </Button>
          <Button size="sm" variant="outline" asChild className="h-9 max-sm:h-10">
            <a href="/nye" target="_blank" rel="noopener noreferrer" aria-label="Open the ticket page">
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="border border-border rounded-md p-2.5">
          <p className={label}>Sold</p>
          <p className="font-body text-[15px] mt-0.5">
            {sold}
            <span className="text-muted-foreground text-[12px]"> / {capacity}</span>
          </p>
        </div>
        <div className="border border-border rounded-md p-2.5">
          <p className={label}>Taken</p>
          <p className="font-body text-[15px] mt-0.5">${Number.isInteger(revenue) ? revenue : revenue.toFixed(2)}</p>
        </div>
        <div className="border border-border rounded-md p-2.5">
          <p className={label}>Checked in</p>
          <p className="font-body text-[15px] mt-0.5">{inside}</p>
        </div>
      </div>
      <div className="space-y-2">
        {releases.map((t) => (
          <div key={t.id}>
            <div className="flex justify-between font-body text-[11px]">
              <span>
                {t.name} · ${t.price}
              </span>
              <span className="text-muted-foreground">
                {t.taken} / {t.capacity}
                {t.taken >= t.capacity ? " · sold out" : live?.current === t.id ? " · on sale" : ""}
              </span>
            </div>
            <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden" aria-hidden>
              <div className="h-full bg-foreground transition-all" style={{ width: `${Math.min(100, (t.taken / t.capacity) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {live && live.held > 0 && (
        <p className="font-body text-[11px] text-muted-foreground">{live.held} held by people paying right now.</p>
      )}

      {reachable === false && <TicketsSetup onCheck={async () => (await checkLive()) && toast.success("Ticket sales are on")} checking={checking} />}
      {reachable && isSinglePrice(live) && (
        <TicketsSetup
          update
          checking={checking}
          onCheck={async () => {
            const { data } = await supabase.functions.invoke("nye-tickets", { body: { action: "availability" } });
            const fresh = data as Availability | null;
            if (fresh && !isSinglePrice(fresh)) {
              setLive(fresh);
              toast.success("Updated — first release $20 is on sale");
            } else toast.error("Still the old version", { description: "Paste the copied code over the function's code in Supabase and tap Deploy." });
          }}
        />
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 font-body text-[12px] py-1.5"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Guest list ({valid.length} order{valid.length === 1 ? "" : "s"})
      </button>

      {open && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, ref…"
              className="h-9 max-sm:h-11 flex-1 min-w-0 text-[12px] max-sm:text-[15px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={exportCsv}
              disabled={shown.length === 0}
              className="h-9 max-sm:h-11 max-sm:w-11 max-sm:p-0"
              aria-label="Export guest list"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
          {shown.length === 0 ? (
            <p className="font-body text-[12px] text-muted-foreground py-4 text-center">
              {orders.length === 0 ? "No tickets sold yet." : "Nobody matches that search."}
            </p>
          ) : (
            <ul className="-mx-4 sm:mx-0 border-y sm:border sm:rounded-md border-border divide-y divide-border">
              {shown.map((o) => {
                const inDoor = o.status === "fulfilled";
                const refunded = o.status === "refunded";
                return (
                  <li key={o.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`font-body text-[13px] truncate ${refunded ? "line-through text-muted-foreground" : ""}`}>
                        {o.customer_name} <span className="text-muted-foreground">× {ticketCount(o)}</span>
                      </p>
                      <p className="font-body text-[11px] text-muted-foreground truncate">
                        <span className="font-mono">{ticketRef(o.id)}</span> · {releasesOf(o)} · {o.customer_email}
                        {refunded ? " · refunded" : ""}
                      </p>
                    </div>
                    {!refunded && (
                      <Button
                        size="sm"
                        variant={inDoor ? "default" : "outline"}
                        onClick={() => toggleIn(o)}
                        disabled={busy === o.id}
                        className="h-9 max-sm:h-10 flex-shrink-0"
                        aria-pressed={inDoor}
                      >
                        {inDoor ? <Check className="w-4 h-4 mr-1" /> : null}
                        {inDoor ? "In" : "Check in"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

export default NyeTicketsPanel;
