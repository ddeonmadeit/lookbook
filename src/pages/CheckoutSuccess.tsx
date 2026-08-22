import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";
import { supabase } from "@/integrations/supabase/client";

interface SessionStatus {
  status: string;
  email: string | null;
  total: number;
  currency: string;
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

  const shell = (children: React.ReactNode) => (
    <div className="h-full bg-background">
      <Navbar />
      <div
        className="flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ height: "calc(100vh - 48px)" }}
      >
        {children}
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

  return shell(
    <>
      <h1 className="font-display text-sm uppercase tracking-[0.2em]">Payment received</h1>
      <p className="font-body text-[11px] text-muted-foreground max-w-xs leading-relaxed">
        Thank you for your order
        {session ? ` — ${session.currency} ${session.total.toFixed(2)}` : ""}. A receipt has been
        emailed{session?.email ? ` to ${session.email}` : ""}, and we'll be in touch when it ships.
      </p>
      <Button asChild variant="outline" className="mt-2 h-11 text-[11px] uppercase tracking-[0.2em] font-body">
        <Link to="/">Back to store</Link>
      </Button>
    </>,
  );
};

export default CheckoutSuccess;
