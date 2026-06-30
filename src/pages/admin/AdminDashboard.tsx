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
import { Loader2, Pencil, Trash2, Plus, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettingsStore, type ProductSource } from "@/stores/settingsStore";
import type { ProductRow } from "@/lib/products";
import ProductForm from "./ProductForm";

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

const AdminDashboard = () => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="font-display text-sm uppercase tracking-[0.2em]">Store Dashboard</h1>
        <Button variant="outline" size="sm" onClick={handleSignOut} className="text-[11px] uppercase tracking-[0.1em]">
          <LogOut className="w-3.5 h-3.5 mr-2" /> Sign out
        </Button>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <Tabs defaultValue="products">
          <TabsList className="mb-6">
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            <ProductsTab />
          </TabsContent>
          <TabsContent value="orders">
            <OrdersTab />
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
              <Badge variant="outline" className="text-[10px] mt-1">{o.status}</Badge>
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
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */
const SettingsTab = () => {
  const settings = useSettingsStore();
  const [source, setSource] = useState<ProductSource>(settings.productSource);
  const [domain, setDomain] = useState(settings.shopifyDomain);
  const [token, setToken] = useState(settings.shopifyStorefrontToken);
  const [apiVersion, setApiVersion] = useState(settings.shopifyApiVersion);
  const [saving, setSaving] = useState(false);

  // keep local form in sync once settings finish loading
  useEffect(() => {
    setSource(settings.productSource);
    setDomain(settings.shopifyDomain);
    setToken(settings.shopifyStorefrontToken);
    setApiVersion(settings.shopifyApiVersion);
  }, [settings.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    const { error } = await settings.save({
      productSource: source,
      shopifyDomain: domain,
      shopifyStorefrontToken: token,
      shopifyApiVersion: apiVersion,
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
