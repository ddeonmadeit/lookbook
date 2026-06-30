import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

export type ProductSource = "manual" | "shopify";

// Fallbacks used only if the store_settings row can't be read (e.g. migration not
// applied yet). These mirror the values the storefront originally hard-coded.
const DEFAULT_SHOPIFY_DOMAIN = "ca653b-54.myshopify.com";
const DEFAULT_SHOPIFY_TOKEN = "847bb7089d786a2dd3a8cf057a4351f7";
const DEFAULT_SHOPIFY_API_VERSION = "2025-07";

export interface StoreSettings {
  productSource: ProductSource;
  shopifyDomain: string;
  shopifyStorefrontToken: string;
  shopifyApiVersion: string;
}

interface SettingsState extends StoreSettings {
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  save: (partial: Partial<StoreSettings>) => Promise<{ error: string | null }>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  productSource: "manual",
  shopifyDomain: DEFAULT_SHOPIFY_DOMAIN,
  shopifyStorefrontToken: DEFAULT_SHOPIFY_TOKEN,
  shopifyApiVersion: DEFAULT_SHOPIFY_API_VERSION,
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (!error && data) {
        set({
          productSource: (data.product_source as ProductSource) ?? "manual",
          shopifyDomain: data.shopify_domain || DEFAULT_SHOPIFY_DOMAIN,
          shopifyStorefrontToken: data.shopify_storefront_token || DEFAULT_SHOPIFY_TOKEN,
          shopifyApiVersion: data.shopify_api_version || DEFAULT_SHOPIFY_API_VERSION,
        });
      }
    } catch (err) {
      console.error("Failed to load store settings:", err);
    } finally {
      set({ loaded: true, loading: false });
    }
  },

  save: async (partial) => {
    const next = { ...get(), ...partial };
    const { error } = await supabase
      .from("store_settings")
      .upsert({
        id: 1,
        product_source: next.productSource,
        shopify_domain: next.shopifyDomain || null,
        shopify_storefront_token: next.shopifyStorefrontToken || null,
        shopify_api_version: next.shopifyApiVersion,
      });

    if (error) return { error: error.message };

    set({
      productSource: next.productSource,
      shopifyDomain: next.shopifyDomain,
      shopifyStorefrontToken: next.shopifyStorefrontToken,
      shopifyApiVersion: next.shopifyApiVersion,
    });
    return { error: null };
  },
}));

/** Ensure settings are loaded once, then return the current snapshot. */
export async function ensureSettings(): Promise<StoreSettings> {
  const state = useSettingsStore.getState();
  if (!state.loaded) {
    await state.load();
  }
  const s = useSettingsStore.getState();
  return {
    productSource: s.productSource,
    shopifyDomain: s.shopifyDomain,
    shopifyStorefrontToken: s.shopifyStorefrontToken,
    shopifyApiVersion: s.shopifyApiVersion,
  };
}
