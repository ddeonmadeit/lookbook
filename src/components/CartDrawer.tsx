import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2, Loader2, X } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

// Bag icon matching yeezy.com style
const BagIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 01-8 0" />
  </svg>
);

export const CartDrawer = () => {
  const navigate = useNavigate();
  const { cartOpen: isOpen, setCartOpen: setIsOpen, menuOpen } = useUIStore();
  const { items, isLoading, isSyncing, updateQuantity, removeItem, getCheckoutUrl, syncCart } = useCartStore();
  const productSource = useSettingsStore((s) => s.productSource);
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + (parseFloat(item.price.amount) * item.quantity), 0);

  useEffect(() => { if (isOpen) syncCart(); }, [isOpen, syncCart]);

  const handleCheckout = () => {
    // Manual catalog: collect order details on our own checkout page.
    if (productSource === "manual") {
      setIsOpen(false);
      navigate("/checkout");
      return;
    }
    // Shopify: hand off to the hosted Shopify checkout.
    const checkoutUrl = getCheckoutUrl();
    if (checkoutUrl) {
      window.open(checkoutUrl, '_blank');
      setIsOpen(false);
    }
  };

  // When both menu and cart are open, cart takes the right half
  const isSplit = isOpen && menuOpen;

  return (
    <>
      {/* Trigger button in navbar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-8 h-8 flex items-center justify-center text-foreground hover:text-muted-foreground transition-colors"
      >
        <BagIcon className="h-[18px] w-[18px]" />
        {totalItems > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-foreground text-background text-[9px] font-body font-medium flex items-center justify-center">
            {totalItems}
          </span>
        )}
      </button>

      {/* Overlay - only when cart is open and menu is NOT (split mode has its own overlay) */}
      {isOpen && !menuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 animate-in fade-in-0"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Cart panel */}
      <div
        className={`fixed top-0 bottom-0 z-[55] bg-background border-l border-border flex flex-col pt-[env(safe-area-inset-top)] p-6 shadow-lg transition-transform duration-300 ease-out ${
          isSplit ? "right-0 w-1/2" : "right-0 w-full sm:max-w-md"
        } ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Close button */}
        <button
          onClick={() => setIsOpen(false)}
          className="absolute right-4 top-4 mt-[env(safe-area-inset-top)] rounded-sm opacity-70 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex-shrink-0 mt-2">
          <h2 className="font-display text-sm uppercase tracking-[0.15em]">Bag</h2>
          <p className="text-[11px] font-body text-muted-foreground mt-1">
            {totalItems === 0 ? "Your bag is empty" : `${totalItems} item${totalItems !== 1 ? 's' : ''}`}
          </p>
        </div>

        <div className="flex flex-col flex-1 pt-6 min-h-0">
          {items.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <BagIcon className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground font-body text-[11px] uppercase tracking-[0.1em]">Your bag is empty</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto pr-2 min-h-0">
                <div className="space-y-4">
                  {items.map((item) => (
                    <div key={item.variantId} className="flex gap-4 py-4 border-b border-border">
                      <div className="w-20 h-20 bg-background overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {item.product.node.images?.edges?.[0]?.node && (
                          <img src={item.product.node.images.edges[0].node.url} alt={item.product.node.title} className="max-w-full max-h-full object-contain" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-body font-medium text-[11px] uppercase tracking-[0.08em] truncate">{item.product.node.title}</h4>
                        <p className="text-[10px] text-muted-foreground font-body mt-0.5">{item.selectedOptions.map(o => o.value).join(' / ')}</p>
                        <p className="font-body font-medium text-xs mt-1.5">${parseFloat(item.price.amount).toFixed(0)}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <button className="w-6 h-6 border border-border flex items-center justify-center hover:border-foreground transition-colors" onClick={() => updateQuantity(item.variantId, item.quantity - 1)}>
                            <Minus className="h-2.5 w-2.5" />
                          </button>
                          <span className="w-6 text-center text-[11px] font-body">{item.quantity}</span>
                          <button className="w-6 h-6 border border-border flex items-center justify-center hover:border-foreground transition-colors" onClick={() => updateQuantity(item.variantId, item.quantity + 1)}>
                            <Plus className="h-2.5 w-2.5" />
                          </button>
                          <button className="ml-auto text-muted-foreground hover:text-foreground transition-colors" onClick={() => removeItem(item.variantId)}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 space-y-4 pt-4 border-t border-border">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-body uppercase tracking-[0.1em]">Total</span>
                  <span className="text-sm font-body font-medium">${totalPrice.toFixed(0)}</span>
                </div>
                <Button onClick={handleCheckout} className="w-full h-12 text-[11px] uppercase tracking-[0.2em] font-body" size="lg" disabled={items.length === 0 || isLoading || isSyncing}>
                  {isLoading || isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Checkout</>}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
