import type { LucideIcon } from "lucide-react";
import { BellRing, LayoutDashboard, Receipt, Settings, Shirt, Smartphone, Users } from "lucide-react";

export type AdminTab = "overview" | "products" | "orders" | "customers" | "signups" | "reminders" | "settings";

export const ADMIN_TABS: Array<{ value: AdminTab; label: string; icon: LucideIcon }> = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "products", label: "Products", icon: Shirt },
  { value: "orders", label: "Orders", icon: Receipt },
  { value: "customers", label: "Customers", icon: Users },
  { value: "signups", label: "Early Access", icon: Smartphone },
  { value: "reminders", label: "Reminders", icon: BellRing },
  { value: "settings", label: "Settings", icon: Settings },
];

/** Tabs with their own spot in the phone tab bar; the rest live under "More". */
export const BAR_TABS: AdminTab[] = ["overview", "products", "orders", "customers"];

const STORAGE_KEY = "admin_tab";

export function readStoredTab(): AdminTab {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (ADMIN_TABS.some((x) => x.value === t)) return t as AdminTab;
  } catch {
    // storage unavailable (private browsing etc.)
  }
  return "overview";
}

export function storeTab(tab: AdminTab) {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}
