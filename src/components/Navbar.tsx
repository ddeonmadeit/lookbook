import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { CartDrawer } from "./CartDrawer";
import logoSrc from "@/assets/logo.gif";
import { Plus, X } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

interface NavbarProps {
  sticky?: boolean;
  glassEffect?: boolean;
}

export const Navbar = ({ sticky = true, glassEffect = true }: NavbarProps) => {
  const { menuOpen, setMenuOpen, cartOpen } = useUIStore();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!sticky || !glassEffect) return;
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sticky, glassEffect]);

  const showGlass = sticky && glassEffect && scrolled;

  // When both panels are open, they split the screen
  const isSplit = menuOpen && cartOpen;

  return (
    <>
      {/* Menu toggle - always on top */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className={`fixed top-[env(safe-area-inset-top)] left-0 z-[60] ml-5 h-[56px] w-8 flex items-center justify-center text-foreground hover:text-muted-foreground transition-colors ${cartOpen ? "hidden" : ""}`}
        aria-label="Toggle menu"
      >
        {menuOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>

      <nav
        className={`${sticky ? "fixed" : "relative"} top-0 left-0 right-0 z-50 ${sticky ? "pt-[env(safe-area-inset-top)]" : ""} transition-all duration-300 ${
          showGlass ? "bg-background/85 backdrop-blur-md border-b border-border/20" : ""
        }`}
      >
        <div className="w-full px-5 py-3 flex items-center justify-between">
          {/* Spacer for toggle button */}
          <div className="w-8 h-8" />

          {/* Center: Logo - hidden when menu is open */}
          <div className={`absolute left-1/2 -translate-x-1/2 transition-opacity duration-300 ${menuOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
            <Link to="/">
              <img
                src={logoSrc}
                alt="Knots"
                className={`w-auto transition-all duration-500 ease-out ${
                  showGlass ? "h-16" : "h-8"
                }`}
              />
            </Link>
          </div>

          {/* Right: Cart bag icon */}
          <CartDrawer />
        </div>
      </nav>

      {/* Overlay when menu is open (without cart, cart has its own overlay in non-split mode) */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[54] bg-black/80"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Menu panel */}
      <div
        className={`fixed left-0 top-0 bottom-0 z-[55] bg-background border-r border-border p-8 pt-[env(safe-area-inset-top)] transition-all duration-300 ease-out ${
          isSplit ? "w-1/2" : "w-64"
        } ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="pt-20">
          <div className="flex items-center gap-3 mb-10">
            <img src={logoSrc} alt="Knots" className="h-10 w-auto" />
          </div>
          <nav className="flex flex-col gap-5">
            <Link
              to="/"
              onClick={() => setMenuOpen(false)}
              className="text-sm font-body font-medium tracking-[0.15em] uppercase text-foreground hover:text-muted-foreground transition-colors"
            >
              Store
            </Link>
            <Link
              to="/about"
              onClick={() => setMenuOpen(false)}
              className="text-sm font-body font-medium tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              About
            </Link>
            <Link
              to="/contact"
              onClick={() => setMenuOpen(false)}
              className="text-sm font-body font-medium tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Contact
            </Link>
          </nav>
        </div>
      </div>
    </>
  );
};
