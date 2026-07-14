import { create } from "zustand";

const STORAGE_KEY = "admin_theme";
export type AdminTheme = "light" | "dark";

function readStored(): AdminTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

interface AdminThemeState {
  theme: AdminTheme;
  toggle: () => void;
}

/**
 * The admin dashboard's light/dark preference. A single shared store (rather
 * than per-component state) so applying it to <html> can live in one stable
 * place (see App.tsx's SiteGate) instead of being tied to the mount/unmount
 * lifecycle of individual lazy-loaded admin pages.
 */
export const useAdminThemeStore = create<AdminThemeState>((set, get) => ({
  theme: readStored(),
  toggle: () => {
    const next: AdminTheme = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore (private browsing, storage disabled, etc.)
    }
    set({ theme: next });
  },
}));
