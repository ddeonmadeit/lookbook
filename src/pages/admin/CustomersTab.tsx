import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** One person, aggregated from every order they've placed. */
interface CustomerRow {
  email: string;
  name: string | null;
  phone: string | null;
  shipping_address: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  currency: string | null;
  orders_count: number;
  total_spent: number;
  first_order_at: string | null;
  last_order_at: string | null;
}

/** Someone who left a contact detail without (yet) buying. */
interface LeadRow {
  source: string;
  id: string;
  email: string | null;
  phone: string | null;
  detail: string | null;
  created_at: string;
}

interface OrderSummary {
  id: string;
  customer_email: string;
  created_at: string;
  status: string;
  currency: string;
  total: number;
  subtotal: number;
  items: Array<{ title: string; quantity: number }> | null;
}

type SortKey = "spent" | "orders" | "recent" | "name";

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "spent", label: "Top spenders" },
  { value: "orders", label: "Most orders" },
  { value: "recent", label: "Most recent" },
  { value: "name", label: "Name A–Z" },
];

const SOURCE_LABELS: Record<string, string> = {
  early_access: "Early access",
  restock: "Restock request",
};

function money(currency: string | null, amount: number) {
  return `${currency || "AUD"} ${(Number(amount) || 0).toFixed(2)}`;
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

/**
 * Everyone who has bought from us, with their lifetime numbers, plus the
 * people who've only handed over a phone number so far. Both read from views
 * over the underlying tables, so the figures can't drift out of sync with the
 * orders themselves.
 */
const CustomersTab = () => {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("spent");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [customerRes, leadRes, orderRes] = await Promise.all([
      supabase.from("customers").select("*"),
      supabase.from("customer_leads").select("*").order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("id,customer_email,created_at,status,currency,total,subtotal,items")
        .order("created_at", { ascending: false }),
    ]);

    if (customerRes.error) {
      toast.error("Failed to load customers", { description: customerRes.error.message });
    }
    setCustomers((customerRes.data as unknown as CustomerRow[]) || []);
    setLeads((leadRes.data as unknown as LeadRow[]) || []);
    setOrders((orderRes.data as unknown as OrderSummary[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ordersByEmail = useMemo(() => {
    const map = new Map<string, OrderSummary[]>();
    for (const o of orders) {
      const key = (o.customer_email || "").trim().toLowerCase();
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [orders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = customers.filter(
      (c) =>
        !q ||
        c.email.includes(q) ||
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q) ||
        (c.postcode ?? "").includes(q),
    );

    const sorted = [...matched];
    sorted.sort((a, b) => {
      switch (sort) {
        case "orders":
          return b.orders_count - a.orders_count || b.total_spent - a.total_spent;
        case "recent":
          return (b.last_order_at ?? "").localeCompare(a.last_order_at ?? "");
        case "name":
          return (a.name ?? a.email).localeCompare(b.name ?? b.email);
        default:
          return Number(b.total_spent) - Number(a.total_spent);
      }
    });
    return sorted;
  }, [customers, search, sort]);

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) =>
        (l.phone ?? "").toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.detail ?? "").toLowerCase().includes(q),
    );
  }, [leads, search]);

  const totals = useMemo(() => {
    const spend = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0);
    const repeat = customers.filter((c) => c.orders_count > 1).length;
    return {
      spend,
      repeat,
      average: customers.length ? spend / customers.length : 0,
    };
  }, [customers]);

  const handleExport = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = visible.map((c) =>
      [
        c.name,
        c.email,
        c.phone,
        c.orders_count,
        Number(c.total_spent || 0).toFixed(2),
        c.currency,
        (c.shipping_address || "").replace(/\n/g, ", "),
        c.city,
        c.state,
        c.postcode,
        c.country,
        c.first_order_at,
        c.last_order_at,
      ]
        .map(esc)
        .join(","),
    );
    const header =
      "name,email,phone,orders,total_spent,currency,address,city,state,postcode,country,first_order,last_order";
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knots-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stat = "font-body text-[10px] uppercase tracking-[0.12em] text-muted-foreground";

  return (
    <div className="space-y-5">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Customers", value: String(customers.length) },
          { label: "Lifetime revenue", value: money("AUD", totals.spend) },
          { label: "Average spend", value: money("AUD", totals.average) },
          { label: "Repeat buyers", value: String(totals.repeat) },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-md p-3">
            <p className={stat}>{s.label}</p>
            <p className="font-body text-[15px] mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone, postcode…"
          className="h-9 flex-1 min-w-[180px] text-[12px]"
        />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-9 w-[150px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-[12px]">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={visible.length === 0}
          className="h-9"
        >
          <Download className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {customers.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-8 text-center">
          No customers yet — they appear here as soon as an order is paid.
        </p>
      ) : visible.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-8 text-center">
          No customers match that search.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => {
            const open = expanded === c.email;
            const history = ordersByEmail.get(c.email) ?? [];
            return (
              <div key={c.email} className="border border-border rounded-md">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : c.email)}
                  aria-expanded={open}
                  className="w-full text-left p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-body text-[12px] font-medium truncate flex items-center gap-1.5">
                      {open ? (
                        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                      {c.name || c.email}
                      {c.orders_count > 1 && (
                        <Badge variant="secondary" className="text-[9px] uppercase tracking-[0.1em]">
                          Repeat
                        </Badge>
                      )}
                    </p>
                    <p className="font-body text-[11px] text-muted-foreground truncate pl-5">
                      {c.email}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </p>
                    {(c.city || c.country) && (
                      <p className="font-body text-[11px] text-muted-foreground truncate pl-5">
                        {[c.city, c.state, c.postcode, c.country].filter(Boolean).join(" ")}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-body text-[12px] font-medium">
                      {money(c.currency, c.total_spent)}
                    </p>
                    <p className="font-body text-[10px] text-muted-foreground">
                      {c.orders_count} order{c.orders_count === 1 ? "" : "s"}
                    </p>
                    <p className="font-body text-[10px] text-muted-foreground">
                      Last {when(c.last_order_at)}
                    </p>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border px-4 py-3 space-y-3">
                    {c.shipping_address && (
                      <div>
                        <p className={stat}>Last shipping address</p>
                        <p className="font-body text-[11px] mt-1 whitespace-pre-wrap">
                          {c.shipping_address}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className={stat}>Order history</p>
                      <div className="mt-1 space-y-1">
                        {history.map((o) => (
                          <div key={o.id} className="flex justify-between gap-3">
                            <span className="font-body text-[11px] text-muted-foreground min-w-0 truncate">
                              {when(o.created_at)} · {o.status} ·{" "}
                              {(o.items ?? [])
                                .map((it) => `${it.quantity}× ${it.title}`)
                                .join(", ")}
                            </span>
                            <span className="font-body text-[11px] whitespace-nowrap">
                              {money(o.currency, Number(o.total) || Number(o.subtotal) || 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="font-body text-[10px] text-muted-foreground">
                      First ordered {when(c.first_order_at)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Leads — people who left a number but haven't ordered. */}
      <div className="pt-4 border-t border-border">
        <p className="font-body text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Sign-ups &amp; enquiries ({visibleLeads.length})
        </p>
        <p className="font-body text-[10px] text-muted-foreground mt-1">
          Everyone who left a contact detail without ordering — early-access sign-ups and
          restock requests.
        </p>
        <div className="mt-3 space-y-1.5">
          {visibleLeads.length === 0 ? (
            <p className="font-body text-[12px] text-muted-foreground py-4">Nothing here yet.</p>
          ) : (
            visibleLeads.map((l) => (
              <div
                key={`${l.source}-${l.id}`}
                className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-body text-[12px] truncate">{l.phone || l.email}</p>
                  {l.detail && (
                    <p className="font-body text-[10px] text-muted-foreground truncate">
                      {l.detail}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="secondary" className="text-[9px] uppercase tracking-[0.1em]">
                    {SOURCE_LABELS[l.source] ?? l.source}
                  </Badge>
                  <span className="font-body text-[10px] text-muted-foreground">
                    {when(l.created_at)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomersTab;
