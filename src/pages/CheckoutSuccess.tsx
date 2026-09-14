import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";
import { supabase } from "@/integrations/supabase/client";
import logoSrc from "@/assets/logo.gif";

interface Address {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
}

interface SessionStatus {
  status: string;
  order_number: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  items: Array<{ title: string | null; quantity: number; amount: number }>;
  shipping_service: string | null;
  shipping_label: string | null;
  address: Address | null;
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
}

function money(currency: string, amount: number) {
  return `${currency} ${amount.toFixed(2)}`;
}

function addressLines(address: Address | null): string[] {
  if (!address) return [];
  const locality = [address.city, address.state, address.postcode].filter(Boolean).join(" ");
  return [address.line1, address.line2, locality, address.country].filter(
    (line): line is string => Boolean(line && line.trim()),
  );
}

// Landing page after Stripe's embedded checkout returns. The webhook (not this
// page) is what marks the order paid and adjusts stock — this confirms the
// outcome with Stripe so we only claim success when payment really completed.
const CheckoutSuccess = () => {
  const clearCart = useCartStore((s) => s.clearCart);
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [state, setState] = useState<"checking" | "paid" | "incomplete">(
    sessionId ? "checking" : "paid",
  );
  const [session, setSession] = useState<SessionStatus | null>(null);

  useEffect(() => {
    if (!sessionId) {
      clearCart();
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("checkout-status", {
          body: { session_id: sessionId },
        });
        const result = data as (SessionStatus & { error?: string }) | null;
        if (error || !result || result.error || result.status !== "complete") {
          setState("incomplete");
          return;
        }
        setSession(result);
        setState("paid");
        clearCart();
      } catch {
        setState("incomplete");
      }
    })();
  }, [sessionId, clearCart]);

  // A receipt, not a shop page: the wordmark is the whole header, so the page
  // reads as ours without the storefront chrome competing with it.
  const shell = (children: React.ReactNode, centred = true) => (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-md px-6 pt-12 pb-16">
        <Link to="/" className="block w-fit mx-auto" aria-label="Knots — back to store">
          <img src={logoSrc} alt="Knots" className="h-12 w-auto" />
        </Link>
        <div
          className={
            centred ? "flex flex-col items-center justify-center gap-4 text-center pt-16" : "pt-2"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );

  if (state === "checking") {
    return shell(
      <>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="font-body text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          Confirming your payment
        </p>
      </>,
    );
  }

  if (state === "incomplete") {
    return shell(
      <>
        <h1 className="font-display text-sm uppercase tracking-[0.2em]">Payment not completed</h1>
        <p className="font-body text-[11px] text-muted-foreground max-w-xs leading-relaxed">
          Your card hasn't been charged. Your bag is still saved if you'd like to try again.
        </p>
        <Button asChild variant="outline" className="mt-2 h-11 text-[11px] uppercase tracking-[0.2em] font-body">
          <Link to="/checkout">Back to checkout</Link>
        </Button>
      </>,
    );
  }

  const label = "font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground";
  const lines = addressLines(session?.address ?? null);
  const service = session?.shipping_service === "express" ? "Express" : "Standard";

  return shell(
    <>
      {/* Masthead — the receipt should read as ours at a glance. */}
      <div className="flex flex-col items-center text-center pt-8 pb-8">
        <div className="flex items-center justify-center w-9 h-9 rounded-full border border-foreground">
          <Check className="w-4 h-4" strokeWidth={1.5} />
        </div>
        <h1 className="mt-4 font-display text-sm uppercase tracking-[0.2em]">Order confirmed</h1>
        <p className="mt-2 font-body text-[11px] text-muted-foreground leading-relaxed max-w-xs">
          Thank you{session?.name ? `, ${session.name.split(" ")[0]}` : ""}. We've got your order
          {session?.email ? ` and sent a confirmation to ${session.email}` : ""}.
        </p>
        {session?.order_number && (
          <p className="mt-3 font-body text-[11px] tracking-[0.18em]">{session.order_number}</p>
        )}
      </div>

      {/* Items */}
      <div className="border-t border-border">
        {(session?.items ?? []).map((item, i) => (
          <div
            key={`${item.title}-${i}`}
            className="flex items-start justify-between gap-4 py-3 border-b border-border"
          >
            <p className="font-body text-[11px] uppercase tracking-[0.06em]">
              {item.quantity > 1 ? `${item.quantity} × ` : ""}
              {item.title}
            </p>
            <p className="font-body text-[11px] whitespace-nowrap">
              {money(session?.currency ?? "AUD", item.amount)}
            </p>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="mt-4 space-y-2">
        <div className="flex justify-between">
          <span className={label}>Subtotal</span>
          <span className="font-body text-[12px]">
            {money(session?.currency ?? "AUD", session?.subtotal ?? 0)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className={label}>{service} shipping</span>
          <span className="font-body text-[12px]">
            {session?.shipping
              ? money(session.currency, session.shipping)
              : "Free"}
          </span>
        </div>
        <div className="flex justify-between pt-2 border-t border-border">
          <span className="font-body text-[11px] uppercase tracking-[0.1em]">Total</span>
          <span className="font-body text-sm font-medium">
            {money(session?.currency ?? "AUD", session?.total ?? 0)}
          </span>
        </div>
      </div>

      {/* Where it's going */}
      {lines.length > 0 && (
        <div className="mt-8 border-t border-border pt-4">
          <p className={label}>Shipping to</p>
          <div className="mt-2 font-body text-[12px] leading-relaxed">
            {session?.name && <p>{session.name}</p>}
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {session?.phone && <p className="text-muted-foreground">{session.phone}</p>}
          </div>
          <p className="mt-3 font-body text-[10px] text-muted-foreground leading-relaxed">
            Posted from Sydney. We'll send you tracking as soon as it's on its way.
          </p>
        </div>
      )}

      <Button
        asChild
        variant="outline"
        className="mt-8 w-full h-11 text-[11px] uppercase tracking-[0.2em] font-body"
      >
        <Link to="/">Continue shopping</Link>
      </Button>
    </>,
    false,
  );
};

export default CheckoutSuccess;
