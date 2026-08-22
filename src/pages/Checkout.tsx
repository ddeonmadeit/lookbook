import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Lock, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { useCartStore } from "@/stores/cartStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { supabase } from "@/integrations/supabase/client";
import { COUNTRIES } from "@/lib/countries";

const COUNTRY_KEY = "knots-ship-country";

interface Quote {
  currency: string;
  subtotal: number;
  shipping: number;
  total: number;
  label: string;
  free: boolean;
}

/** $170 stays "$170"; $18.45 shows its cents. */
function money(amount: number) {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * supabase.functions.invoke() reports any non-2xx as a generic
 * "Edge Function returned a non-2xx status code" and leaves `data` null, so
 * the real reason ("Not enough stock left for X") is only in the response
 * body. Dig it out — those messages are the ones a shopper can act on.
 */
async function functionError(error: unknown, data: unknown, fallback: string) {
  const fromData = (data as { error?: string } | null)?.error;
  if (fromData) return fromData;

  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.clone().json();
      if (body?.error) return body.error as string;
    } catch {
      /* body wasn't JSON — fall through */
    }
  }
  return fallback;
}

const Checkout = () => {
  const { items, clearCart } = useCartStore();
  const paymentsEnabled = useSettingsStore((s) => s.paymentsEnabled);

  const [country, setCountry] = useState<string>(
    () => localStorage.getItem(COUNTRY_KEY) || "AU",
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });

  const subtotal = items.reduce(
    (sum, item) => sum + parseFloat(item.price.amount) * item.quantity,
    0,
  );

  const cartKey = useMemo(
    () => items.map((i) => `${i.variantId}:${i.quantity}`).join("|"),
    [items],
  );
  const cartLines = useCallback(
    () =>
      items.map((i) => ({
        product_id: i.product.node.id,
        variant_id: i.variantId,
        quantity: i.quantity,
      })),
    [items],
  );

  useEffect(() => {
    localStorage.setItem(COUNTRY_KEY, country);
  }, [country]);

  // Live shipping quote whenever the destination or the bag changes. Stale
  // responses are discarded so a slow earlier request can't overwrite a newer
  // one with the wrong country's price.
  const quoteSeq = useRef(0);
  useEffect(() => {
    if (!paymentsEnabled || items.length === 0) return;
    const seq = ++quoteSeq.current;
    setQuoting(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("shipping-quote", {
          body: { items: cartLines(), country },
        });
        if (seq !== quoteSeq.current) return;
        const result = data as (Quote & { error?: string }) | null;
        if (error || !result || result.error) {
          setQuote(null);
        } else {
          setQuote(result);
        }
      } catch {
        if (seq === quoteSeq.current) setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    })();
  }, [country, cartKey, paymentsEnabled, items.length, cartLines]);

  // Changing the destination invalidates any payment session already opened.
  useEffect(() => {
    setClientSecret(null);
  }, [country, cartKey]);

  const startPayment = async () => {
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          items: cartLines(),
          country,
          return_url: `${window.location.origin}/checkout/success`,
        },
      });
      const result = data as
        | { client_secret?: string; publishable_key?: string; error?: string }
        | null;
      if (error || !result?.client_secret || !result?.publishable_key) {
        toast.error("Checkout unavailable", {
          description: await functionError(error, data, "Payment could not be started."),
        });
        return;
      }
      setPublishableKey(result.publishable_key);
      setClientSecret(result.client_secret);
    } catch {
      toast.error("Checkout unavailable", { description: "Please try again." });
    } finally {
      setStarting(false);
    }
  };

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const update =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
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
        product_id: i.product.node.id,
        variant_id: i.variantId,
        title: i.product.node.title,
        handle: i.product.node.handle,
        variantTitle: i.variantTitle,
        selectedOptions: i.selectedOptions,
        price: i.price.amount,
        quantity: i.quantity,
        image: i.product.node.images?.edges?.[0]?.node?.url ?? null,
      }));

      const { error } = await supabase.rpc("place_order", {
        p_items: orderItems,
        p_subtotal: subtotal,
        p_currency: items[0]?.price.currencyCode || "AUD",
        p_customer_name: form.name.trim(),
        p_customer_email: form.email.trim(),
        p_customer_phone: form.phone.trim() || null,
        p_shipping_address: form.address.trim() || null,
        p_notes: form.notes.trim() || null,
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
        <div
          className="flex flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ height: "calc(100vh - 48px)" }}
        >
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
        <div
          className="flex flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ height: "calc(100vh - 48px)" }}
        >
          <p className="font-body text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Your bag is empty
          </p>
          <Button asChild variant="outline" className="h-11 text-[11px] uppercase tracking-[0.2em] font-body">
            <Link to="/">Back to store</Link>
          </Button>
        </div>
      </div>
    );
  }

  const rowLabel = "font-body text-[11px] uppercase tracking-[0.1em]";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <Navbar />
      <div className="h-12" />
      <div className={`mx-auto px-6 pb-16 ${clientSecret ? "max-w-xl" : "max-w-md"}`}>
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
                <p className="font-body text-[11px] uppercase tracking-[0.06em] truncate">
                  {item.product.node.title}
                </p>
                <p className="font-body text-[10px] text-muted-foreground">
                  {item.selectedOptions.map((o) => o.value).join(" / ")}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                </p>
              </div>
              <p className="font-body text-[11px]">
                {money(parseFloat(item.price.amount) * item.quantity)}
              </p>
            </div>
          ))}
        </div>

        {paymentsEnabled ? (
          <>
            {/* Destination — drives the shipping price, so it's chosen here
                rather than being a surprise at the payment step. */}
            {!clientSecret && (
              <div className="mt-5 space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">
                  Deliver to
                </Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger className="font-body text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code} className="text-[12px]">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Totals */}
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              <div className="flex justify-between items-center">
                <span className={`${rowLabel} text-muted-foreground`}>Subtotal</span>
                <span className="font-body text-[12px]">{money(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`${rowLabel} text-muted-foreground`}>Shipping</span>
                <span className="font-body text-[12px]">
                  {quoting ? (
                    <Loader2 className="w-3 h-3 animate-spin inline" />
                  ) : quote ? (
                    quote.free ? "Free" : money(quote.shipping)
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className={rowLabel}>Total</span>
                <span className="font-body text-sm font-medium">
                  {quote ? money(quote.total) : money(subtotal)}
                </span>
              </div>
            </div>

            {/* Payment — Stripe renders inside our page, no redirect. */}
            {clientSecret && stripePromise ? (
              <div className="mt-6">
                <button
                  onClick={() => setClientSecret(null)}
                  className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"
                >
                  <ChevronLeft className="w-3 h-3" /> Change delivery country
                </button>
                <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <Button
                  onClick={startPayment}
                  disabled={starting || quoting || !quote}
                  className="w-full h-12 text-[11px] uppercase tracking-[0.2em] font-body"
                >
                  {starting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5 mr-2" /> Pay {quote ? money(quote.total) : ""}
                    </>
                  )}
                </Button>
                <p className="font-body text-[10px] text-muted-foreground text-center leading-relaxed">
                  Secure payment by Stripe, completed right here — you're never sent to another
                  site. Card details never touch our servers.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex justify-between items-center pt-3">
              <span className={rowLabel}>Total</span>
              <span className="font-body text-sm font-medium">{money(subtotal)}</span>
            </div>
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
          </>
        )}
      </div>
    </div>
  );
};

export default Checkout;
