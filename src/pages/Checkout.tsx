import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/stores/cartStore";
import { supabase } from "@/integrations/supabase/client";

const Checkout = () => {
  const navigate = useNavigate();
  const { items, clearCart } = useCartStore();
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });

  const subtotal = items.reduce(
    (sum, item) => sum + parseFloat(item.price.amount) * item.quantity,
    0,
  );
  const currency = items[0]?.price.currencyCode || "USD";

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    if (items.length === 0) {
      toast.error("Your bag is empty");
      return;
    }

    setSubmitting(true);
    try {
      const orderItems = items.map((i) => ({
        title: i.product.node.title,
        handle: i.product.node.handle,
        variantTitle: i.variantTitle,
        selectedOptions: i.selectedOptions,
        price: i.price.amount,
        quantity: i.quantity,
        image: i.product.node.images?.edges?.[0]?.node?.url ?? null,
      }));

      const { error } = await supabase.from("orders").insert({
        items: orderItems,
        subtotal,
        currency,
        customer_name: form.name.trim(),
        customer_email: form.email.trim(),
        customer_phone: form.phone.trim() || null,
        shipping_address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });

      if (error) {
        toast.error("Could not place order", { description: error.message });
        return;
      }

      clearCart();
      setPlaced(true);
    } catch (err) {
      toast.error("Something went wrong");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (placed) {
    return (
      <div className="h-full bg-background">
        <Navbar />
        <div className="flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ height: "calc(100vh - 48px)" }}>
          <h1 className="font-display text-sm uppercase tracking-[0.2em]">Order received</h1>
          <p className="font-body text-[11px] text-muted-foreground max-w-xs leading-relaxed">
            Thank you, {form.name.split(" ")[0]}. We've recorded your order and will reach out at{" "}
            <span className="text-foreground">{form.email}</span> to arrange payment and shipping.
          </p>
          <Button asChild variant="outline" className="mt-2 h-11 text-[11px] uppercase tracking-[0.2em] font-body">
            <Link to="/">Back to store</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full bg-background">
        <Navbar />
        <div className="flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ height: "calc(100vh - 48px)" }}>
          <p className="font-body text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Your bag is empty</p>
          <Button asChild variant="outline" className="h-11 text-[11px] uppercase tracking-[0.2em] font-body">
            <Link to="/">Back to store</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <Navbar />
      <div className="h-12" />
      <div className="max-w-md mx-auto px-6 pb-16">
        <h1 className="font-display text-sm uppercase tracking-[0.2em] mb-6">Checkout</h1>

        {/* Order summary */}
        <div className="border-t border-border">
          {items.map((item) => (
            <div key={item.variantId} className="flex items-center gap-3 py-3 border-b border-border">
              <div className="w-14 h-14 flex items-center justify-center flex-shrink-0">
                {item.product.node.images?.edges?.[0]?.node && (
                  <img
                    src={item.product.node.images.edges[0].node.url}
                    alt={item.product.node.title}
                    className="max-w-full max-h-full object-contain"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-[11px] uppercase tracking-[0.06em] truncate">{item.product.node.title}</p>
                <p className="font-body text-[10px] text-muted-foreground">
                  {item.selectedOptions.map((o) => o.value).join(" / ")}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                </p>
              </div>
              <p className="font-body text-[11px]">${(parseFloat(item.price.amount) * item.quantity).toFixed(0)}</p>
            </div>
          ))}
          <div className="flex justify-between items-center pt-3">
            <span className="font-body text-[11px] uppercase tracking-[0.1em]">Total</span>
            <span className="font-body text-sm font-medium">${subtotal.toFixed(0)}</span>
          </div>
        </div>

        {/* Customer details */}
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Name *</Label>
            <Input id="name" value={form.name} onChange={update("name")} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Email *</Label>
            <Input id="email" type="email" value={form.email} onChange={update("email")} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Phone</Label>
            <Input id="phone" value={form.phone} onChange={update("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Shipping address</Label>
            <Textarea id="address" value={form.address} onChange={update("address")} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={update("notes")} rows={2} />
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-12 text-[11px] uppercase tracking-[0.2em] font-body"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Place order"}
          </Button>
          <p className="font-body text-[10px] text-muted-foreground text-center leading-relaxed">
            No payment is taken here. We'll contact you to arrange payment and delivery.
          </p>
        </form>
      </div>
    </div>
  );
};

export default Checkout;
