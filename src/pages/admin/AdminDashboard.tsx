import { useEffect, useState, useCallback, useRef } from "react";
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
  Import,
  RefreshCw,
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
import ShopifyImportDialog from "./ShopifyImportDialog";
import OptimisePhotosDialog from "./OptimisePhotosDialog";
import { needsOptimising } from "@/lib/photoUpdates";
import OverviewTab from "./OverviewTab";
import CustomersTab from "./CustomersTab";
import EmailTemplatesTab from "./EmailTemplatesTab";
import { useAdminThemeStore } from "@/stores/adminThemeStore";
import { usePullToRefresh, PULL_THRESHOLD } from "@/hooks/usePullToRefresh";
import { useMediaQuery, PHONE } from "@/hooks/useMediaQuery";
import { PHONE_SHEET, keepKeyboardClosed } from "./phoneSheet";
import { BottomTabBar, MoreDrawer } from "./AdminMobileNav";
import { ADMIN_TABS, type AdminTab, readStoredTab, storeTab } from "./adminTabs";

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
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postcode: string | null;
  shipping_service: string | null;
  confirmation_sent_at: string | null;
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
  const [tab, setTab] = useState<AdminTab>(readStoredTab);
  const [moreOpen, setMoreOpen] = useState(false);
  // Bumped to remount the open section, which reloads its data.
  const [refreshKey, setRefreshKey] = useState(0);
  const [toFulfil, setToFulfil] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login", { replace: true });
  };

  const selectTab = (next: string) => {
    const t = next as AdminTab;
    if (t === tab) {
      // Tapping the open tab again scrolls back to the top, like a native app.
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setTab(t);
    storeTab(t);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  // Paid orders still waiting to ship: shown as a badge on Orders.
  const loadBadges = useCallback(async () => {
    const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid");
    setToFulfil(count ?? 0);
  }, []);
  useEffect(() => {
    loadBadges();
  }, [loadBadges, tab, refreshKey]);

  const { pull, refreshing } = usePullToRefresh(scrollRef, () => setRefreshKey((k) => k + 1));
  const badges = { orders: toFulfil };
  const label = ADMIN_TABS.find((t) => t.value === tab)?.label ?? "";

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex-shrink-0 border-b border-border px-4 sm:px-6 h-14 sm:h-auto sm:py-4 flex items-center justify-between gap-2 bg-background">
        <h1 className="font-display text-sm uppercase tracking-[0.2em] truncate">
          <span className="sm:hidden">{label}</span>
          <span className="hidden sm:inline">Store Dashboard</span>
        </h1>
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" asChild className="text-[11px] uppercase tracking-[0.1em]">
            <a href={import.meta.env.BASE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-2" />
              Preview live site
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
          <Button variant="outline" size="sm" onClick={handleSignOut} className="text-[11px] uppercase tracking-[0.1em]">
            <LogOut className="w-3.5 h-3.5 mr-2" />
            Sign out
          </Button>
        </div>
      </header>

      <main ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain relative">
        {/* Pull-to-refresh indicator (phones) */}
        <div
          aria-hidden={!refreshing}
          className="sm:hidden absolute inset-x-0 top-0 flex justify-center pointer-events-none"
          style={{ height: pull, opacity: Math.min(1, pull / PULL_THRESHOLD) }}
        >
          <RefreshCw
            className={`w-5 h-5 mt-3 text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
            style={refreshing ? undefined : { transform: `rotate(${(pull / PULL_THRESHOLD) * 270}deg)` }}
          />
        </div>
        <div
          className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:py-8 pb-[calc(88px+env(safe-area-inset-bottom))] sm:pb-8"
          // A margin, not a transform: a transform would re-anchor fixed children (the add button) while pulling.
          style={pull ? { marginTop: pull } : undefined}
        >
          <Tabs value={tab} onValueChange={selectTab}>
            <div className="hidden sm:block mb-6">
              <TabsList className="w-max">
                {ADMIN_TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                    {(badges[t.value as keyof typeof badges] ?? 0) > 0 && (
                      <span className="ml-1.5 min-w-[16px] h-4 px-1 rounded-full bg-foreground text-background text-[10px] leading-4">
                        {badges[t.value as keyof typeof badges]}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="overview" key={`overview-${refreshKey}`}>
              <OverviewTab />
            </TabsContent>
            <TabsContent value="products" key={`products-${refreshKey}`}>
              <ProductsTab />
            </TabsContent>
            <TabsContent value="orders" key={`orders-${refreshKey}`}>
              <OrdersTab onChanged={loadBadges} />
            </TabsContent>
            <TabsContent value="customers" key={`customers-${refreshKey}`}>
              <CustomersTab />
            </TabsContent>
            <TabsContent value="signups" key={`signups-${refreshKey}`}>
              <SignupsTab />
            </TabsContent>
            <TabsContent value="reminders" key={`reminders-${refreshKey}`}>
              <RemindersTab />
            </TabsContent>
            <TabsContent value="settings" key={`settings-${refreshKey}`}>
              <SettingsTab />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <BottomTabBar tab={tab} onSelect={selectTab} onMore={() => setMoreOpen(true)} badges={badges} />
      <MoreDrawer
        open={moreOpen}
        onOpenChange={setMoreOpen}
        tab={tab}
        onSelect={selectTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={handleSignOut}
        badges={badges}
      />
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
            <img
              src={product.images[0].thumb || product.images[0].url}
              alt={product.title}
              loading="lazy"
              className="max-w-full max-h-full object-contain"
            />
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

/** Phone row: tap anywhere to edit, drag the handle to reorder. */
const SortableProductCard = ({ product, onEdit }: { product: ProductRow; onEdit: (p: ProductRow) => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: product.id });
  const image = product.images?.[0];
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center bg-background ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <button
        type="button"
        onClick={() => onEdit(product)}
        className="flex flex-1 min-w-0 items-center gap-3 pl-3 py-2.5 text-left active:bg-muted transition-colors"
      >
        <span className="w-14 h-14 flex-shrink-0 rounded-md bg-muted/40 flex items-center justify-center overflow-hidden">
          {image?.url && (
            <img src={image.thumb || image.url} alt="" loading="lazy" className="max-w-full max-h-full object-contain" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-body text-[14px] leading-snug line-clamp-2">{product.title}</span>
          <span className="block font-body text-[12px] text-muted-foreground mt-0.5">
            {product.currency} {Number(product.price).toFixed(0)}
            {product.sort_order ? ` · #${String(product.sort_order).padStart(3, "0")}` : ""}
          </span>
        </span>
        <span
          className={`flex-shrink-0 font-body text-[11px] px-2 py-0.5 rounded-full border ${
            product.available ? "border-transparent bg-secondary text-secondary-foreground" : "border-border text-muted-foreground"
          }`}
        >
          {product.available ? "In stock" : "Sold out"}
        </span>
      </button>
      <button
        type="button"
        className="self-stretch px-3 flex items-center cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={`Drag to reorder ${product.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-5 h-5" />
      </button>
    </li>
  );
};

const ProductsTab = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const phone = useMediaQuery(PHONE);
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

  /** Returns whether it was deleted. */
  const handleDelete = async (p: ProductRow) => {
    if (!confirm(`Delete "${p.title}"?`)) return false;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return false;
    }
    toast.success("Product deleted");
    load();
    return true;
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

  // Products whose photos (or description media) still load from Shopify, or aren't optimised yet.
  const toOptimise = products.filter(
    (p) => p.images?.some(needsOptimising) || (p.description_html ?? "").includes("cdn.shopify.com"),
  ).length;

  const nextPosition = products.length
    ? Math.max(...products.map((p) => p.position ?? 0)) + 1
    : 1;

  return (
    // Phone: room at the end so the last product can scroll clear of the add button.
    <div className="max-sm:pb-16">
      <div className="flex justify-between items-center mb-4 gap-2">
        <p className="font-body text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          {products.length} product{products.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-[11px] max-sm:h-10 max-sm:w-10 max-sm:p-0"
                disabled={products.length < 2}
                aria-label="Sort by"
              >
                <ArrowUpDown className="w-3.5 h-3.5 sm:mr-1.5 max-sm:w-4 max-sm:h-4" />
                <span className="hidden sm:inline">Sort by</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_PRESETS.map((preset) => (
                <DropdownMenuItem key={preset.value} onClick={() => applyPreset(preset.value)} className="max-sm:min-h-11">
                  {preset.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="text-[11px] max-sm:h-10 max-sm:w-10 max-sm:p-0"
            onClick={() => setImportOpen(true)}
            aria-label="Restore old products"
          >
            <Import className="w-3.5 h-3.5 sm:mr-1.5 max-sm:w-4 max-sm:h-4" />
            <span className="hidden sm:inline">Restore old products</span>
          </Button>
          <Button size="sm" onClick={openAdd} className="hidden sm:inline-flex">
            <Plus className="w-4 h-4 mr-1" /> Add product
          </Button>
        </div>
      </div>

      {!loading && toOptimise > 0 && (
        <div className="border border-border rounded-md p-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="font-body text-[11px] text-muted-foreground">
            {toOptimise} product{toOptimise !== 1 ? "s have" : " has"} photos that still load from Shopify's servers or
            aren't optimised, which makes the shop slow. Optimise them to move everything into your storage at a fraction
            of the size.
          </p>
          <Button size="sm" className="flex-shrink-0" onClick={() => setPhotosOpen(true)}>
            Optimise photos
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-12 text-center">
          No products yet. Click “Add product” to create your first one, or “Restore old products” to bring back
          your old Shopify catalogue.
        </p>
      ) : phone ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={products.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul className="-mx-4 border-y border-border divide-y divide-border">
              {products.map((p) => (
                <SortableProductCard key={p.id} product={p} onEdit={openEdit} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
        {phone
          ? "Tap a product to edit it. Drag the handle to reorder the shop grid."
          : 'Drag the handle to reorder the storefront grid, or use "Sort by" for a one-click layout.'}
      </p>

      {/* Phone: add button floating above the tab bar */}
      <button
        type="button"
        onClick={openAdd}
        aria-label="Add product"
        className="sm:hidden fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus className="w-6 h-6" />
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={`max-w-2xl max-h-[90vh] overflow-y-auto ${PHONE_SHEET}`} onOpenAutoFocus={keepKeyboardClosed}>
          <DialogHeader>
            <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">
              {editing ? "Edit product" : "Add product"}
            </DialogTitle>
          </DialogHeader>
          <ProductForm
            product={editing}
            nextPosition={nextPosition}
            onSaved={onSaved}
            onCancel={() => setDialogOpen(false)}
            onDelete={
              editing
                ? async () => {
                    if (await handleDelete(editing)) setDialogOpen(false);
                  }
                : undefined
            }
          />
        </DialogContent>
      </Dialog>

      <ShopifyImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
      <OptimisePhotosDialog open={photosOpen} onOpenChange={setPhotosOpen} onUpdated={load} />
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

/** `onChanged` runs after an order's status changes (keeps the tab badge current). */
const OrdersTab = ({ onChanged }: { onChanged?: () => void }) => {
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
    onChanged?.();
    return true;
  };

  const setStatus = (id: string, status: string) => patch(id, { status });

  /**
   * Marks the order fulfilled and tells the customer. Tracking is optional —
   * plenty of parcels go out before a number exists — so the button works
   * either way. The edge function owns this rather than a direct update
   * because it also sends the "shipped" email/SMS.
   */
  const fulfil = async (
    o: OrderRow,
    number: string,
    carrier: string,
    channels: { email: boolean; sms: boolean },
  ) => {
    const trimmed = number.trim();
    setBusyId(o.id);
    try {
      const { data, error } = await supabase.functions.invoke("fulfil-order", {
        body: {
          order_id: o.id,
          tracking_number: trimmed || null,
          tracking_carrier: trimmed ? carrier : null,
          notify_email: channels.email,
          notify_sms: channels.sms,
        },
      });
      const result = data as
        | { ok?: boolean; error?: string; notification?: { email: string; sms: string; reason?: string } }
        | null;
      if (error || !result?.ok) {
        toast.error("Could not mark as fulfilled", {
          description: result?.error || error?.message || "Please try again.",
        });
        return;
      }

      setOrders((os) =>
        os.map((x) =>
          x.id === o.id
            ? {
                ...x,
                status: "fulfilled",
                tracking_number: trimmed || null,
                tracking_carrier: trimmed ? carrier : null,
                shipped_at: new Date().toISOString(),
              }
            : x,
        ),
      );

      onChanged?.();
      const n = result.notification;
      const sent = [n?.email === "sent" && "email", n?.sms === "sent" && "SMS"].filter(Boolean);
      toast.success("Marked as fulfilled", {
        description: sent.length
          ? `Customer notified by ${sent.join(" and ")}.`
          : n?.reason
            ? `Customer not notified — ${n.reason}`
            : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  /** Tracking only, without re-sending a shipped notification. */
  const saveTracking = async (o: OrderRow, number: string, carrier: string) => {
    const trimmed = number.trim();
    setBusyId(o.id);
    const ok = await patch(o.id, {
      tracking_number: trimmed || null,
      tracking_carrier: trimmed ? carrier : null,
    });
    setBusyId(null);
    if (ok) toast.success(trimmed ? "Tracking saved" : "Tracking cleared");
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
      <div className="flex gap-2 items-center">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, tracking, item…"
          className="h-9 max-sm:h-11 flex-1 min-w-0 text-[12px] max-sm:text-[15px]"
        />
        <Button size="sm" variant="outline" onClick={handleExport} className="h-9 max-sm:h-11 max-sm:w-11 max-sm:p-0" aria-label="Export CSV">
          <Download className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      {/* Status filter: one tap, with counts, scrolls sideways on narrow screens */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 w-max">
          {(["all", ...ORDER_STATUSES] as const).map((st) => {
            const n = st === "all" ? orders.length : orders.filter((o) => o.status === st).length;
            const active = statusFilter === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                aria-pressed={active}
                className={`h-8 max-sm:h-9 px-3 rounded-full border font-body text-[11px] max-sm:text-[12px] capitalize whitespace-nowrap transition-colors ${
                  active ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground active:bg-muted"
                }`}
              >
                {st === "all" ? "All" : st}
                <span className={active ? "opacity-70" : "opacity-60"}> {n}</span>
              </button>
            );
          })}
        </div>
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
          onFulfil={fulfil}
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
  onFulfil,
  onRefund,
}: {
  order: OrderRow;
  busy: boolean;
  onStatus: (id: string, status: string) => void;
  onSaveTracking: (o: OrderRow, number: string, carrier: string) => void;
  onFulfil: (
    o: OrderRow,
    number: string,
    carrier: string,
    channels: { email: boolean; sms: boolean },
  ) => void;
  onRefund: (o: OrderRow) => void;
}) => {
  const [tracking, setTracking] = useState(o.tracking_number ?? "");
  const [carrier, setCarrier] = useState(o.tracking_carrier ?? CARRIERS[0]);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);

  const paid = Number(o.total) || Number(o.subtotal) || 0;
  const refunded = Number(o.refunded_amount) || 0;
  const refundable = o.payment_provider === "stripe" && paid - refunded > 0.005;
  const dirty = (o.tracking_number ?? "") !== tracking.trim() ||
    (tracking.trim() !== "" && (o.tracking_carrier ?? CARRIERS[0]) !== carrier);

  return (
    <div className="border border-border rounded-md p-4">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-body text-[12px] max-sm:text-[14px] font-medium truncate">{o.customer_name}</p>
          <a
            href={`mailto:${o.customer_email}`}
            className="block font-body text-[11px] max-sm:text-[12px] max-sm:py-0.5 text-muted-foreground truncate underline-offset-2 hover:underline"
          >
            {o.customer_email}
          </a>
          {o.customer_phone && (
            <a
              href={`tel:${o.customer_phone.replace(/\s+/g, "")}`}
              className="block font-body text-[11px] max-sm:text-[12px] max-sm:py-0.5 text-muted-foreground underline-offset-2 hover:underline"
            >
              {o.customer_phone}
            </a>
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
              <SelectTrigger className="h-7 max-sm:h-9 w-[110px] text-[11px] capitalize" aria-label="Order status">
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
      <p className="font-body text-[10px] text-muted-foreground mt-1.5">
        {o.shipping_service === "express" ? "Express" : "Standard"} shipping
        {o.confirmation_sent_at
          ? ` · confirmation sent ${new Date(o.confirmation_sent_at).toLocaleDateString()}`
          : ""}
      </p>
      {o.notes && (
        <p className="font-body text-[11px] text-muted-foreground mt-2 italic">“{o.notes}”</p>
      )}

      {/* Fulfilment. Tracking is optional — the order can be marked fulfilled
          before a number exists, and the number added later. */}
      <div className="mt-3 border-t border-border pt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={carrier} onValueChange={setCarrier}>
            <SelectTrigger className="h-8 max-sm:h-11 w-[140px] max-sm:w-full text-[11px]" aria-label="Carrier">
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
            placeholder="Tracking number (optional)"
            className="h-8 max-sm:h-11 flex-1 min-w-[140px] text-[12px]"
          />
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-[11px] text-muted-foreground"
              disabled={busy}
              onClick={() => onSaveTracking(o, tracking, carrier)}
            >
              Save only
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            className="h-8 max-sm:h-11 max-sm:w-full text-[11px] max-sm:text-[12px]"
            disabled={busy || o.status === "cancelled" || o.status === "refunded"}
            onClick={() => onFulfil(o, tracking, carrier, { email: notifyEmail, sms: notifySms })}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Truck className="w-3.5 h-3.5 mr-1.5" />
            )}
            {o.status === "fulfilled" ? "Resend & update" : "Mark as fulfilled"}
          </Button>
          <label className="flex items-center gap-1.5 max-sm:gap-2 max-sm:min-h-[40px] font-body text-[11px] max-sm:text-[13px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.checked)}
              className="accent-current max-sm:w-5 max-sm:h-5"
            />
            Email
          </label>
          <label className="flex items-center gap-1.5 max-sm:gap-2 max-sm:min-h-[40px] font-body text-[11px] max-sm:text-[13px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={notifySms}
              onChange={(e) => setNotifySms(e.target.checked)}
              disabled={!o.customer_phone}
              className="accent-current max-sm:w-5 max-sm:h-5"
            />
            Text{!o.customer_phone ? " (no number)" : ""}
          </label>
          {refundable && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 max-sm:h-10 text-[11px] max-sm:text-[12px] text-muted-foreground ml-auto"
              disabled={busy}
              onClick={() => onRefund(o)}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Refund
            </Button>
          )}
        </div>
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
/* Restock reminders ("remind me" captures from sold-out product pages)        */
/* -------------------------------------------------------------------------- */
interface ReminderRow {
  id: string;
  product_handle: string;
  product_title: string;
  phone: string;
  notified_at: string | null;
  created_at: string;
}

const RemindersTab = () => {
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("restock_reminders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("Failed to load reminders", { description: error.message });
    setRows((data as unknown as ReminderRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Grouped by product so it's obvious what to restock first.
  const byProduct = rows.reduce<Record<string, { title: string; rows: ReminderRow[] }>>((acc, r) => {
    const key = r.product_handle;
    if (!acc[key]) acc[key] = { title: r.product_title, rows: [] };
    acc[key].rows.push(r);
    return acc;
  }, {});
  const groups = Object.entries(byProduct).sort((a, b) => b[1].rows.length - a[1].rows.length);

  const markNotified = async (handle: string) => {
    const ids = byProduct[handle].rows.filter((r) => !r.notified_at).map((r) => r.id);
    if (ids.length === 0) return;
    const stamp = new Date().toISOString();
    setRows((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, notified_at: stamp } : r)));
    const { error } = await supabase
      .from("restock_reminders")
      .update({ notified_at: stamp })
      .in("id", ids);
    if (error) {
      toast.error("Could not update", { description: error.message });
      load();
      return;
    }
    toast.success(`Marked ${ids.length} as notified`);
  };

  const handleExport = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((r) =>
      [r.product_title, r.product_handle, r.phone, r.created_at, r.notified_at ?? ""].map(esc).join(","),
    );
    const blob = new Blob([["product,handle,phone,requested_at,notified_at", ...body].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knots-restock-reminders-${new Date().toISOString().slice(0, 10)}.csv`;
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

  const waiting = rows.filter((r) => !r.notified_at).length;

  return (
    <div>
      <div className="flex justify-between items-center mb-4 gap-2">
        <p className="font-body text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          {rows.length} request{rows.length !== 1 ? "s" : ""}
          {waiting > 0 ? ` · ${waiting} still waiting` : ""}
        </p>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          <Download className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Export CSV</span>
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="font-body text-[12px] text-muted-foreground py-12 text-center">
          No restock requests yet. They appear here when someone leaves their number
          on a sold-out product.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([handle, group]) => {
            const pending = group.rows.filter((r) => !r.notified_at).length;
            return (
              <div key={handle} className="border border-border rounded-md p-4">
                <div className="flex justify-between items-start gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-body text-[12px] font-medium truncate">{group.title}</p>
                    <p className="font-body text-[10px] text-muted-foreground">
                      {group.rows.length} waiting{pending !== group.rows.length ? ` · ${group.rows.length - pending} notified` : ""}
                    </p>
                  </div>
                  {pending > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-[11px] flex-shrink-0"
                      onClick={() => markNotified(handle)}
                    >
                      Mark notified
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.rows.map((r) => (
                    <span
                      key={r.id}
                      className={`font-body text-[11px] border border-border rounded px-2 py-1 ${
                        r.notified_at ? "text-muted-foreground line-through" : ""
                      }`}
                      title={new Date(r.created_at).toLocaleString()}
                    >
                      {r.phone}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
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

      {/* Breaks the settings column: the HTML editor and its preview need the
          full width to be usable. */}
      <div className="border-t border-border pt-5 w-[calc(100vw-2rem)] sm:w-auto sm:max-w-none lg:w-[64rem]">
        <EmailTemplatesTab />
      </div>

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
