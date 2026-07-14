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
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, Trash2, Plus, LogOut, Download, Sun, Moon, ExternalLink } from "lucide-react";
import { toast } from "sonner";
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
  currency: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address: string | null;
  notes: string | null;
  status: string;
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
const ProductsTab = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
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

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="font-body text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
          {products.length} product{products.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" /> Add product
        </Button>
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
                <TableHead className="w-16"></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="w-10 h-10 flex items-center justify-center">
                      {p.images?.[0]?.url && (
                        <img src={p.images[0].url} alt={p.title} className="max-w-full max-h-full object-contain" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-body text-[12px]">{p.title}</div>
                    <div className="font-body text-[10px] text-muted-foreground">{p.handle}</div>
                  </TableCell>
                  <TableCell className="font-body text-[12px]">
                    {p.currency} {Number(p.price).toFixed(0)}
                  </TableCell>
                  <TableCell>
                    {p.available ? (
                      <Badge variant="secondary" className="text-[10px]">In stock</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Sold out</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(p)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-sm uppercase tracking-[0.15em]">
              {editing ? "Edit product" : "Add product"}
            </DialogTitle>
          </DialogHeader>
          <ProductForm product={editing} onSaved={onSaved} onCancel={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */
const ORDER_STATUSES = ["pending", "paid", "fulfilled", "cancelled"] as const;

const OrdersTab = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) toast.error("Failed to load orders", { description: error.message });
      setOrders((data as unknown as OrderRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const setStatus = async (id: string, status: string) => {
    const prev = orders;
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, status } : o)));
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) {
      setOrders(prev);
      toast.error("Could not update order", { description: error.message });
    }
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

  return (
    <div className="space-y-4">
      {orders.map((o) => (
        <div key={o.id} className="border border-border rounded-md p-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-body text-[12px] font-medium">{o.customer_name}</p>
              <p className="font-body text-[11px] text-muted-foreground">{o.customer_email}</p>
              {o.customer_phone && (
                <p className="font-body text-[11px] text-muted-foreground">{o.customer_phone}</p>
              )}
            </div>
            <div className="text-right">
              <p className="font-body text-[12px] font-medium">
                {o.currency} {Number(o.subtotal).toFixed(0)}
              </p>
              <p className="font-body text-[10px] text-muted-foreground">
                {new Date(o.created_at).toLocaleDateString()}
              </p>
              <div className="mt-1 flex justify-end">
                <Select value={o.status} onValueChange={(v) => setStatus(o.id, v)}>
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
        </div>
      ))}
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
  const [saving, setSaving] = useState(false);

  // keep local form in sync once settings finish loading
  useEffect(() => {
    setSiteMode(settings.siteMode);
    setSource(settings.productSource);
    setDomain(settings.shopifyDomain);
    setToken(settings.shopifyStorefrontToken);
    setApiVersion(settings.shopifyApiVersion);
    setPaymentsEnabled(settings.paymentsEnabled);
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
