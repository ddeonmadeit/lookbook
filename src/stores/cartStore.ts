import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  type CartItem,
  type ShopifyProduct,
  storefrontApiRequest,
  CART_QUERY,
  createShopifyCart,
  addLineToShopifyCart,
  updateShopifyCartLine,
  removeLineFromShopifyCart,
} from '@/lib/shopify';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settingsStore';

export type { CartItem, ShopifyProduct };

function isManual() {
  return useSettingsStore.getState().productSource === 'manual';
}

/** Remaining stock for a cart item's variant; null = untracked. */
function stockFor(item: Pick<CartItem, 'product' | 'variantId'>): number | null {
  const variant = item.product.node.variants.edges.find(
    ({ node }) => node.id === item.variantId,
  )?.node;
  return variant?.stock ?? null;
}

function capToStock(item: Pick<CartItem, 'product' | 'variantId'>, wanted: number): number {
  const stock = stockFor(item);
  if (stock === null || wanted <= stock) return wanted;
  toast.error(stock > 0 ? `Only ${stock} left in stock` : 'Sold out');
  return stock;
}

function newLineId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `line_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  checkoutUrl: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  addItem: (item: Omit<CartItem, 'lineId'>) => Promise<void>;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => void;
  syncCart: () => Promise<void>;
  getCheckoutUrl: () => string | null;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      cartId: null,
      checkoutUrl: null,
      isLoading: false,
      isSyncing: false,

      addItem: async (item) => {
        const { items, cartId, clearCart } = get();
        const existingItem = items.find(i => i.variantId === item.variantId);

        // Manual source: a purely local cart, checkout happens via /checkout.
        if (isManual()) {
          if (existingItem) {
            const wanted = capToStock(existingItem, existingItem.quantity + item.quantity);
            if (wanted <= 0) return;
            set({
              items: items.map(i =>
                i.variantId === item.variantId ? { ...i, quantity: wanted } : i,
              ),
            });
          } else {
            const wanted = capToStock(item, item.quantity);
            if (wanted <= 0) return;
            set({ items: [...items, { ...item, quantity: wanted, lineId: newLineId() }] });
          }
          return;
        }

        set({ isLoading: true });
        try {
          if (!cartId) {
            const result = await createShopifyCart({ ...item, lineId: null });
            if (result) {
              set({
                cartId: result.cartId,
                checkoutUrl: result.checkoutUrl,
                items: [{ ...item, lineId: result.lineId }],
              });
            }
          } else if (existingItem) {
            const newQuantity = existingItem.quantity + item.quantity;
            if (!existingItem.lineId) return;
            const result = await updateShopifyCartLine(cartId, existingItem.lineId, newQuantity);
            if (result.success) {
              set({ items: get().items.map(i => i.variantId === item.variantId ? { ...i, quantity: newQuantity } : i) });
            } else if (result.cartNotFound) {
              clearCart();
            }
          } else {
            const result = await addLineToShopifyCart(cartId, { ...item, lineId: null });
            if (result.success) {
              set({ items: [...get().items, { ...item, lineId: result.lineId ?? null }] });
            } else if (result.cartNotFound) {
              clearCart();
            }
          }
        } catch (error) {
          console.error('Failed to add item:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      updateQuantity: async (variantId, quantity) => {
        if (quantity <= 0) {
          await get().removeItem(variantId);
          return;
        }

        if (isManual()) {
          const target = get().items.find(i => i.variantId === variantId);
          const wanted = target ? capToStock(target, quantity) : quantity;
          if (wanted <= 0) {
            await get().removeItem(variantId);
            return;
          }
          set({ items: get().items.map(i => i.variantId === variantId ? { ...i, quantity: wanted } : i) });
          return;
        }

        const { items, cartId, clearCart } = get();
        const item = items.find(i => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;

        set({ isLoading: true });
        try {
          const result = await updateShopifyCartLine(cartId, item.lineId, quantity);
          if (result.success) {
            set({ items: get().items.map(i => i.variantId === variantId ? { ...i, quantity } : i) });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } catch (error) {
          console.error('Failed to update quantity:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      removeItem: async (variantId) => {
        if (isManual()) {
          const newItems = get().items.filter(i => i.variantId !== variantId);
          if (newItems.length === 0) get().clearCart();
          else set({ items: newItems });
          return;
        }

        const { items, cartId, clearCart } = get();
        const item = items.find(i => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;

        set({ isLoading: true });
        try {
          const result = await removeLineFromShopifyCart(cartId, item.lineId);
          if (result.success) {
            const newItems = get().items.filter(i => i.variantId !== variantId);
            if (newItems.length === 0) clearCart();
            else set({ items: newItems });
          } else if (result.cartNotFound) {
            clearCart();
          }
        } catch (error) {
          console.error('Failed to remove item:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      clearCart: () => set({ items: [], cartId: null, checkoutUrl: null }),
      getCheckoutUrl: () => get().checkoutUrl,

      syncCart: async () => {
        if (isManual()) return;

        const { cartId, isSyncing, clearCart } = get();
        if (!cartId || isSyncing) return;
        set({ isSyncing: true });
        try {
          const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
          if (!data) return;
          const cart = data?.data?.cart;
          if (!cart || cart.totalQuantity === 0) clearCart();
        } catch (error) {
          console.error('Failed to sync cart:', error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: 'shopify-cart',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items, cartId: state.cartId, checkoutUrl: state.checkoutUrl }),
    }
  )
);
