import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/stores/cartStore";

// Landing page after a successful Stripe payment. The webhook (not this page)
// is what marks the order paid and adjusts stock — this just thanks the
// customer and empties the local bag.
const CheckoutSuccess = () => {
  const clearCart = useCartStore((s) => s.clearCart);

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return (
    <div className="h-full bg-background">
      <Navbar />
      <div
        className="flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ height: "calc(100vh - 48px)" }}
      >
        <h1 className="font-display text-sm uppercase tracking-[0.2em]">Payment received</h1>
        <p className="font-body text-[11px] text-muted-foreground max-w-xs leading-relaxed">
          Thank you for your order. A receipt has been emailed to you, and we'll
          be in touch when it ships.
        </p>
        <Button asChild variant="outline" className="mt-2 h-11 text-[11px] uppercase tracking-[0.2em] font-body">
          <Link to="/">Back to store</Link>
        </Button>
      </div>
    </div>
  );
};

export default CheckoutSuccess;
