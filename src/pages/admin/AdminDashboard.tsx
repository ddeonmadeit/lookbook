import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Pencil,
  Trash2,
  Plus,
  LogOut,
  Download,
  Sun,
  Moon,
  ExternalLink,
  GripVertical,
  ArrowUpDown,
  Truck,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { useSettingsStore, type ProductSource, type SiteMode } from "@/stores/settingsStore";
import type { ProductRow } from "@/lib/products";
import ProductForm from "./ProductForm";
import OverviewTab from "./OverviewTab";
import { useAdminThemeStore } from "@/stores/adminThemeStore";

interface OrderRow {
  id: string;
  items: Array<{ title: string; quantity: number }>;
  subtotal: number;
  shipping_cost: number;
  total: number;
  currency: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address: string | null;
  shipping_country: string | null;
  notes: string | null;
  status: string;
  payment_provider: string;
  tracking_number: string | null;
  tracking_carrier: string | null;
  shipped_at: string | null;
  refunded_amount: number;
  created_at: string;
}

interface PhoneSignupRow {
  id: string;
  phone: string;
  created_at: string;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const theme = useAdminThemeStore((s) => s.theme);
  const toggleTheme = useAdminThemeStore((s) => s.toggle);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="border-b border-border px-3 sm:px-6 py-4 flex items-center justify-between gap-2">
        <h1 className="font-display text-sm uppercase tracking-[0.2em] flex-shrink-0">Store Dashboard</h1>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" asChild className="text-[11px] uppercase tracking-[0.1em] px-2 sm:px-3">
            <a href={import.meta.env.BASE_URL} target="_blank" rel="noopener noreferrer" aria-label="Preview live site">
              <ExternalLink className="w-3.5 h-3.5 sm:mr-2" />
              <span className="hidden sm:inline">Preview live site</span>
            </a>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSignOut} className="text-[11px] uppercase tracking-[0.1em] px-2 sm:px-3" aria-label="Sign out">
            <LogOut className="w-3.5 h-3.5 sm:mr-2" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Tabs defaultValue="overview">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
            <TabsList className="w-max">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="products">Products</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="signups">Early Access</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="products">
            <ProductsTab />
          </TabsContent>
          <TabsContent value="orders">
            <OrdersTab />
          </TabsContent>
          <TabsContent value="signups">
            <SignupsTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */
type SortPreset = "price-desc" | "price-asc" | "name-asc" | "name-desc" | "newest" | "oldest";

const SORT_PRESETS: Array<{ value: SortPreset; label: string }> = [
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "name-asc", label: "Name: A to Z" },
  { value: "name-desc", label: "Name: Z to A" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

function sortByPreset(rows: ProductRow[], preset: SortPreset): ProductRow[] {
  const sorted = [...rows];
  switch (preset) {
    case "price-desc":
      return sorted.sort((a, b) => Number(b.price) - Number(a.price));
    case "price-asc":
      return sorted.sort((a, b) => Number(a.price) - Number(b.price));
    case "name-asc":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "name-desc":
      return sorted.sort((a, b) => b.title.localeCompare(a.title));
    case "newest":
      return sorted.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    case "oldest":
      return sorted.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    default:
      return sorted;
  }
}

/** Draggable row: only the grip handle initiates dragging, so buttons/text stay clickable. */
const SortableProductRow = ({
  product,
  onEdit,
  onDelete,
}: {
  product: ProductRow;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-8">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </TableCell>
      <TableCell>
        <div className="w-10 h-10 flex items-center justify-center">
          {product.images?.[0]?.url && (
            <img src={product.images[0].url} alt={product.title} className="max-w-full max-h-full object-contain" />
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="font-body text-[12px]">{product.title}</div>
        <div className="font-body text-[10px] text-muted-foreground">{product.handle}</div>
      </TableCell>
      <TableCell className="font-body text-[12px]">
        {product.currency} {Number(product.price).toFixed(0)}
      </TableCell>
      <TableCell>
        {product.available ? (
          <Badge variant="secondary" className="text-[10px]">In stock</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Sold out</Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="icon" onClick={() => onEdit(product)}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(product)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

const ProductsTab = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    setLoading(true);
    let { data, error } = await supabase
      .from("products")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    // The "position" column only exists once its migration has been run;
    // fall back to the old ordering rather than showing an empty list.
    if (error) {
      ({ data, error } = await supabase
        .from("products")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }));
    }
    if (error) toast.error("Failed to load products", { description: error.message });
    setProducts((data as unknown as ProductRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: ProductRow) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const handleDelete = async (p: ProductRow) => {
    if (!confirm(`Delete "${p.title}"?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    toast.success("Product deleted");
    load();
  };

  const onSaved = () => {
    setDialogOpen(false);
    load();
  };

  /** Persist the current on-screen order as each row's new `position`. Never
   * touches `sort_order` — that stays the fixed, owner-assigned display number. */
  const persistOrder = async (ordered: ProductRow[]) => {
    setProducts(ordered);
    const results = await Promise.all(
      ordered.map((p, i) => supabase.from("products").update({ position: i + 1 }).eq("id", p.id)),
    );
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) toast.error("Could not save new order", { description: firstError.message });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = products.findIndex((p) => p.id === active.id);
    const newIndex = products.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    persistOrder(arrayMove(products, oldIndex, newIndex));
  };

  const applyPreset = (preset: SortPreset) => {
    persistOrder(sortByPreset(products, preset));
  };

  const nextPosition = products.length
    ? Math.max(...products.map((p) => p.position ?? 0)) + 1
    : 1;

  return (
    <div>
      <div className="flex justify-between items-center mb-4 gap-2">
        <p className="font-body text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          {products.length} product{products.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="text-[11px]" disabled={products.length < 2}>
                <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" /> Sort by
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_PRESETS.map((preset) => (
                <DropdownMenuItem key={preset.value} onClick={() => applyPreset(preset.value)}>
                  {preset.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1" /> Add product
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-12 text-center">
          No products yet. Click “Add product” to create your first one.
        </p>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-16"></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={products.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <TableBody>
                  {products.map((p) => (
                    <SortableProductRow key={p.id} product={p} onEdit={openEdit} onDelete={handleDelete} />
                  ))}
                </TableBody>
              </SortableContext>
            </DndContext>
          </Table>
        </div>
      )}
      <p className="font-body text-[10px] text-muted-foreground mt-2">
        Drag the handle to reorder the storefront grid, or use "Sort by" for a one-click layout.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">
              {editing ? "Edit product" : "Add product"}
            </DialogTitle>
          </DialogHeader>
          <ProductForm product={editing} nextPosition={nextPosition} onSaved={onSaved} onCancel={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */
const ORDER_STATUSES = ["pending", "paid", "fulfilled", "cancelled", "refunded"] as const;

const CARRIERS = ["Australia Post", "DHL", "FedEx", "UPS", "Sendle", "Aramex", "Other"];

/** "AUD 248.40" — orders always show cents, unlike the storefront's round prices. */
function orderMoney(currency: string, amount: number) {
  return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
}

const OrdersTab = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("Failed to load orders", { description: error.message });
    setOrders((data as unknown as OrderRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (id: string, fields: Partial<OrderRow>) => {
    const prev = orders;
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, ...fields } : o)));
    const { error } = await supabase.from("orders").update(fields).eq("id", id);
    if (error) {
      setOrders(prev);
      toast.error("Could not update order", { description: error.message });
      return false;
    }
    return true;
  };

  const setStatus = (id: string, status: string) => patch(id, { status });

  const saveTracking = async (o: OrderRow, number: string, carrier: string) => {
    const trimmed = number.trim();
    setBusyId(o.id);
    const ok = await patch(o.id, {
      tracking_number: trimmed || null,
      tracking_carrier: trimmed ? carrier : null,
      shipped_at: trimmed ? new Date().toISOString() : null,
      ...(trimmed && o.status === "paid" ? { status: "fulfilled" } : {}),
    });
    setBusyId(null);
    if (ok) toast.success(trimmed ? "Tracking saved — order marked fulfilled" : "Tracking cleared");
  };

  const refund = async (o: OrderRow) => {
    const paid = Number(o.total) || Number(o.subtotal) || 0;
    const remaining = paid - (Number(o.refunded_amount) || 0);
    const input = prompt(
      `Refund amount in ${o.currency} (up to ${remaining.toFixed(2)}).\nLeave as-is for a full refund.`,
      remaining.toFixed(2),
    );
    if (input === null) return;
    const amount = parseFloat(input);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setBusyId(o.id);
    try {
      const { data, error } = await supabase.functions.invoke("refund-order", {
        body: { order_id: o.id, amount },
      });
      const result = data as { ok?: boolean; refunded?: number; error?: string } | null;
      if (error || !result?.ok) {
        toast.error("Refund failed", {
          description: result?.error || error?.message || "Please try again.",
        });
        return;
      }
      toast.success(`Refunded ${orderMoney(o.currency, amount)}`);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const filtered = orders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_email?.toLowerCase().includes(q) ||
      o.tracking_number?.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      o.items?.some((it) => it.title?.toLowerCase().includes(q))
    );
  });

  const handleExport = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map((o) =>
      [
        o.id,
        new Date(o.created_at).toISOString(),
        o.status,
        o.customer_name,
        o.customer_email,
        o.customer_phone,
        o.currency,
        Number(o.subtotal || 0).toFixed(2),
        Number(o.shipping_cost || 0).toFixed(2),
        Number(o.total || o.subtotal || 0).toFixed(2),
        Number(o.refunded_amount || 0).toFixed(2),
        o.shipping_country,
        (o.shipping_address || "").replace(/\n/g, ", "),
        o.tracking_carrier,
        o.tracking_number,
        o.items?.map((it) => `${it.quantity}x ${it.title}`).join("; "),
      ]
        .map(esc)
        .join(","),
    );
    const header =
      "order_id,placed_at,status,customer,email,phone,currency,subtotal,shipping,total,refunded,country,address,carrier,tracking,items";
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knots-orders-${new Date().toISOString().slice(0, 10)}.csv`;
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

  if (orders.length === 0) {
    return <p className="font-body text-[12px] text-muted-foreground py-12 text-center">No orders yet.</p>;
  }

  const revenue = orders
    .filter((o) => o.status === "paid" || o.status === "fulfilled")
    .reduce((s, o) => s + (Number(o.total) || Number(o.subtotal) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, tracking, item…"
          className="h-9 flex-1 min-w-[180px] text-[12px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[130px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">All statuses</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-[12px]">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={handleExport} className="h-9">
          <Download className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      <p className="font-body text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
        {filtered.length} of {orders.length} order{orders.length !== 1 ? "s" : ""} · {orderMoney("AUD", revenue)} collected
      </p>

      {filtered.length === 0 && (
        <p className="font-body text-[12px] text-muted-foreground py-8 text-center">
          No orders match that search.
        </p>
      )}

      {filtered.map((o) => (
        <OrderCard
          key={o.id}
          order={o}
          busy={busyId === o.id}
          onStatus={setStatus}
          onSaveTracking={saveTracking}
          onRefund={refund}
        />
      ))}
    </div>
  );
};

const OrderCard = ({
  order: o,
  busy,
  onStatus,
  onSaveTracking,
  onRefund,
}: {
  order: OrderRow;
  busy: boolean;
  onStatus: (id: string, status: string) => void;
  onSaveTracking: (o: OrderRow, number: string, carrier: string) => void;
  onRefund: (o: OrderRow) => void;
}) => {
  const [tracking, setTracking] = useState(o.tracking_number ?? "");
  const [carrier, setCarrier] = useState(o.tracking_carrier ?? CARRIERS[0]);

  const paid = Number(o.total) || Number(o.subtotal) || 0;
  const refunded = Number(o.refunded_amount) || 0;
  const refundable = o.payment_provider === "stripe" && paid - refunded > 0.005;
  const dirty = (o.tracking_number ?? "") !== tracking.trim() ||
    (tracking.trim() !== "" && (o.tracking_carrier ?? CARRIERS[0]) !== carrier);

  return (
    <div className="border border-border rounded-md p-4">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-body text-[12px] font-medium truncate">{o.customer_name}</p>
          <p className="font-body text-[11px] text-muted-foreground truncate">{o.customer_email}</p>
          {o.customer_phone && (
            <p className="font-body text-[11px] text-muted-foreground">{o.customer_phone}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-body text-[12px] font-medium">{orderMoney(o.currency, paid)}</p>
          {Number(o.shipping_cost) > 0 && (
            <p className="font-body text-[10px] text-muted-foreground">
              incl. {orderMoney(o.currency, o.shipping_cost)} shipping
            </p>
          )}
          {refunded > 0 && (
            <p className="font-body text-[10px] text-accent">
              −{orderMoney(o.currency, refunded)} refunded
            </p>
          )}
          <p className="font-body text-[10px] text-muted-foreground">
            {new Date(o.created_at).toLocaleDateString()}
          </p>
          <div className="mt-1 flex justify-end">
            <Select value={o.status} onValueChange={(v) => onStatus(o.id, v)}>
              <SelectTrigger className="h-7 w-[110px] text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-[12px]">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-border pt-2 space-y-0.5">
        {o.items?.map((it, i) => (
          <p key={i} className="font-body text-[11px] text-muted-foreground">
            {it.quantity} × {it.title}
          </p>
        ))}
      </div>

      {o.shipping_address && (
        <p className="font-body text-[11px] text-muted-foreground mt-2 whitespace-pre-wrap">
          {o.shipping_address}
        </p>
      )}
      {o.notes && (
        <p className="font-body text-[11px] text-muted-foreground mt-2 italic">“{o.notes}”</p>
      )}

      {/* Fulfilment: saving a tracking number marks a paid order fulfilled. */}
      <div className="mt-3 border-t border-border pt-3 flex flex-wrap items-center gap-2">
        <Select value={carrier} onValueChange={setCarrier}>
          <SelectTrigger className="h-8 w-[140px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CARRIERS.map((c) => (
              <SelectItem key={c} value={c} className="text-[12px]">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder="Tracking number"
          className="h-8 flex-1 min-w-[140px] text-[12px]"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[11px]"
          disabled={busy || !dirty}
          onClick={() => onSaveTracking(o, tracking, carrier)}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5 sm:mr-1" />}
          <span className="hidden sm:inline">Save</span>
        </Button>
        {refundable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[11px] text-muted-foreground"
            disabled={busy}
            onClick={() => onRefund(o)}
          >
            <RotateCcw className="w-3.5 h-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Refund</span>
          </Button>
        )}
      </div>
      {o.shipped_at && (
        <p className="font-body text-[10px] text-muted-foreground mt-1.5">
          Shipped {new Date(o.shipped_at).toLocaleDateString()}
          {o.tracking_carrier ? ` via ${o.tracking_carrier}` : ""}
        </p>
      )}
    </div>
  );
};


/* -------------------------------------------------------------------------- */
/* Early access phone signups (from the "coming soon" gate)                   */
/* -------------------------------------------------------------------------- */
const SignupsTab = () => {
  const [signups, setSignups] = useState<PhoneSignupRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("phone_signups")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) toast.error("Failed to load signups", { description: error.message });
      setSignups((data as unknown as PhoneSignupRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const handleExport = () => {
    const csv = ["phone,submitted_at", ...signups.map((s) => `"${s.phone}","${s.created_at}"`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "knots-aw26-phones.csv";
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

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="font-body text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          {signups.length} number{signups.length !== 1 ? "s" : ""} collected
        </p>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={signups.length === 0}>
          <Download className="w-4 h-4 mr-1" /> Export CSV
        </Button>
      </div>

      {signups.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-12 text-center">
          No early-access signups yet.
        </p>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signups.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-body text-[12px]">{s.phone}</TableCell>
                  <TableCell className="font-body text-[12px] text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Shipping rate card                                                          */
/* -------------------------------------------------------------------------- */
interface ShippingRateRow {
  id: string;
  zone: string;
  max_weight_grams: number;
  price: number;
}

const ZONE_ORDER = ["AU", "NZ", "ASIA", "NA_ME", "ROW"] as const;
const ZONE_NAMES: Record<string, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  ASIA: "Asia & Pacific",
  NA_ME: "North America & Middle East",
  ROW: "Rest of world",
};

/**
 * Carrier prices by destination zone and parcel weight. Seeded with Australia
 * Post rates ex-Sydney; edit here whenever the carrier repricing lands, no
 * deploy needed.
 */
const ShippingRatesEditor = () => {
  const [rates, setRates] = useState<ShippingRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("shipping_rates")
        .select("*")
        .order("zone")
        .order("max_weight_grams");
      if (error) toast.error("Failed to load shipping rates", { description: error.message });
      setRates((data as unknown as ShippingRateRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const tiers = [...new Set(rates.map((r) => r.max_weight_grams))].sort((a, b) => a - b);
  const zones = ZONE_ORDER.filter((z) => rates.some((r) => r.zone === z));

  const valueFor = (zone: string, tier: number) => {
    const row = rates.find((r) => r.zone === zone && r.max_weight_grams === tier);
    if (!row) return { id: null as string | null, value: "" };
    return { id: row.id, value: dirty[row.id] ?? String(row.price) };
  };

  const save = async () => {
    const entries = Object.entries(dirty);
    if (entries.length === 0) return;
    setSaving(true);
    const results = await Promise.all(
      entries.map(([id, raw]) =>
        supabase
          .from("shipping_rates")
          .update({ price: Math.max(0, parseFloat(raw) || 0) })
          .eq("id", id),
      ),
    );
    setSaving(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error("Could not save rates", { description: failed.error.message });
      return;
    }
    setRates((rs) =>
      rs.map((r) => (dirty[r.id] !== undefined ? { ...r, price: parseFloat(dirty[r.id]) || 0 } : r)),
    );
    setDirty({});
    toast.success("Shipping rates saved");
  };

  if (loading) {
    return (
      <div className="border-t border-border pt-5 flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rates.length === 0) {
    return (
      <div className="border-t border-border pt-5">
        <p className="font-body text-[11px] text-muted-foreground">
          No shipping rate card found — checkout will fall back to the flat rate.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">
          Rate card — carrier cost ex-Sydney (AUD)
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[11px]"
          disabled={saving || Object.keys(dirty).length === 0}
          onClick={save}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save rates"}
        </Button>
      </div>

      <div className="border border-border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px]">Destination</TableHead>
              {tiers.map((t) => (
                <TableHead key={t} className="text-[10px] text-right whitespace-nowrap">
                  ≤{t >= 1000 ? `${t / 1000}kg` : `${t}g`}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {zones.map((zone) => (
              <TableRow key={zone}>
                <TableCell className="font-body text-[11px] whitespace-nowrap">
                  {ZONE_NAMES[zone] ?? zone}
                </TableCell>
                {tiers.map((tier) => {
                  const { id, value } = valueFor(zone, tier);
                  return (
                    <TableCell key={tier} className="p-1">
                      {id ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.05"
                          value={value}
                          onChange={(e) =>
                            setDirty((d) => ({ ...d, [id]: e.target.value }))
                          }
                          className="h-8 w-20 text-[11px] text-right"
                        />
                      ) : (
                        <span className="font-body text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="font-body text-[10px] text-muted-foreground leading-relaxed">
        Seeded from Australia Post's published rates — verify against auspost.com.au
        before you go live. The handling fee above is added on top of whichever
        cell applies. Parcels heavier than the largest tier are billed as multiple
        parcels.
      </p>
    </div>
  );
};
/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */
const SettingsTab = () => {
  const settings = useSettingsStore();
  const [siteMode, setSiteMode] = useState<SiteMode>(settings.siteMode);
  const [source, setSource] = useState<ProductSource>(settings.productSource);
  const [domain, setDomain] = useState(settings.shopifyDomain);
  const [token, setToken] = useState(settings.shopifyStorefrontToken);
  const [apiVersion, setApiVersion] = useState(settings.shopifyApiVersion);
  const [paymentsEnabled, setPaymentsEnabled] = useState(settings.paymentsEnabled);
  const [shippingFlatRate, setShippingFlatRate] = useState(String(settings.shippingFlatRate));
  const [freeShippingThreshold, setFreeShippingThreshold] = useState(
    settings.freeShippingThreshold === null ? "" : String(settings.freeShippingThreshold),
  );
  const [handlingFee, setHandlingFee] = useState(String(settings.shippingHandlingFee));
  const [defaultWeight, setDefaultWeight] = useState(String(settings.defaultItemWeightGrams));
  const [saving, setSaving] = useState(false);

  // keep local form in sync once settings finish loading
  useEffect(() => {
    setSiteMode(settings.siteMode);
    setSource(settings.productSource);
    setDomain(settings.shopifyDomain);
    setToken(settings.shopifyStorefrontToken);
    setApiVersion(settings.shopifyApiVersion);
    setPaymentsEnabled(settings.paymentsEnabled);
    setShippingFlatRate(String(settings.shippingFlatRate));
    setFreeShippingThreshold(
      settings.freeShippingThreshold === null ? "" : String(settings.freeShippingThreshold),
    );
    setHandlingFee(String(settings.shippingHandlingFee));
    setDefaultWeight(String(settings.defaultItemWeightGrams));
  }, [settings.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    const { error } = await settings.save({
      siteMode,
      productSource: source,
      shopifyDomain: domain,
      shopifyStorefrontToken: token,
      shopifyApiVersion: apiVersion,
      paymentsEnabled,
      shippingFlatRate: parseFloat(shippingFlatRate) || 0,
      freeShippingThreshold: freeShippingThreshold.trim() === "" ? null : parseFloat(freeShippingThreshold) || 0,
      shippingHandlingFee: parseFloat(handlingFee) || 0,
      defaultItemWeightGrams: parseInt(defaultWeight, 10) || 0,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save settings", { description: error });
      return;
    }
    toast.success("Settings saved");
  };

  const label = "text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground";

  return (
    <div className="max-w-md space-y-6">
      <div className="space-y-1.5">
        <Label className={label}>Site visibility</Label>
        <Select value={siteMode} onValueChange={(v) => setSiteMode(v as SiteMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="coming_soon">Coming soon (countdown page)</SelectItem>
            <SelectItem value="live">Live (full site)</SelectItem>
          </SelectContent>
        </Select>
        <p className="font-body text-[10px] text-muted-foreground leading-relaxed">
          {siteMode === "coming_soon"
            ? "Visitors see the AW26 countdown / early-access page. Only you (signed in here) can reach the rest of the site."
            : "The full storefront is visible to everyone."}
        </p>
      </div>

      <div className="space-y-1.5 border-t border-border pt-5">
        <Label className={label}>Product source</Label>
        <Select value={source} onValueChange={(v) => setSource(v as ProductSource)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual (this dashboard)</SelectItem>
            <SelectItem value="shopify">Shopify</SelectItem>
          </SelectContent>
        </Select>
        <p className="font-body text-[10px] text-muted-foreground leading-relaxed">
          {source === "manual"
            ? "The storefront shows products you add here, and checkout records orders for you to fulfil."
            : "The storefront pulls products from Shopify and checkout uses Shopify's hosted checkout."}
        </p>
      </div>

      <div className="space-y-1.5 border-t border-border pt-5">
        <Label className={label}>Online payments</Label>
        <Select
          value={paymentsEnabled ? "on" : "off"}
          onValueChange={(v) => setPaymentsEnabled(v === "on")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off — record orders, arrange payment yourself</SelectItem>
            <SelectItem value="on">On — secure card checkout via Stripe</SelectItem>
          </SelectContent>
        </Select>
        <p className="font-body text-[10px] text-muted-foreground leading-relaxed">
          {paymentsEnabled
            ? "Checkout sends customers to Stripe's hosted payment page. Requires the Stripe keys to be configured (see PAYMENTS.md in the repo)."
            : "Checkout records the order and tells the customer you'll contact them to arrange payment."}
        </p>
      </div>

      <div className="space-y-4 border-t border-border pt-5">
        <p className={label}>Shipping</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className={label}>Handling fee ($)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={handlingFee}
              onChange={(e) => setHandlingFee(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={label}>Free over ($)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="never"
              value={freeShippingThreshold}
              onChange={(e) => setFreeShippingThreshold(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={label}>Default item weight (g)</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={defaultWeight}
              onChange={(e) => setDefaultWeight(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={label}>Fallback flat rate ($)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={shippingFlatRate}
              onChange={(e) => setShippingFlatRate(e.target.value)}
            />
          </div>
        </div>
        <p className="font-body text-[10px] text-muted-foreground leading-relaxed">
          Checkout prices each parcel from the rate card below by destination and
          total weight, then adds the handling fee. The fallback flat rate is only
          used if a zone has no rates at all.
        </p>
      </div>

      <ShippingRatesEditor />

      <div className="space-y-4 border-t border-border pt-5">
        <p className={label}>Shopify connection</p>
        <div className="space-y-1.5">
          <Label className={label}>Store domain</Label>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="your-store.myshopify.com" />
        </div>
        <div className="space-y-1.5">
          <Label className={label}>Storefront access token</Label>
          <Input value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className={label}>API version</Label>
          <Input value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} placeholder="2025-07" />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save settings"}
      </Button>
    </div>
  );
};

export default AdminDashboard;
