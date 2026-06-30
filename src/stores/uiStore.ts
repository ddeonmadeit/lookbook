import { create } from "zustand";

interface UIState {
  cartOpen: boolean;
  menuOpen: boolean;
  setCartOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  cartOpen: false,
  menuOpen: false,
  setCartOpen: (open) => set({ cartOpen: open }),
  setMenuOpen: (open) => set({ menuOpen: open }),
}));
