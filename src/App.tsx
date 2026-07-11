import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useCartSync } from "@/hooks/useCartSync";
import { useSettingsStore } from "@/stores/settingsStore";
import Index from "./pages/Index";
import ProductDetail from "./pages/ProductDetail";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Checkout from "./pages/Checkout";
import ComingSoon from "./pages/ComingSoon";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import RequireAdmin from "./pages/admin/RequireAdmin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// While site_mode is "coming_soon", every route except /admin (so the owner
// can still log in, manage products, and flip the switch) shows the
// countdown/early-access page instead of the real storefront.
const SiteGate = () => {
  const siteMode = useSettingsStore((s) => s.siteMode);
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");

  if (siteMode === "coming_soon" && !isAdminRoute) {
    return <ComingSoon />;
  }

  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/product/:handle" element={<ProductDetail />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const AppContent = () => {
  const loadSettings = useSettingsStore((s) => s.load);
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);
  useCartSync();
  // Respect Vite's base path so the app works under a subpath (e.g. GitHub Pages /lookbook/).
  const basename = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <BrowserRouter basename={basename}>
      <SiteGate />
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppContent />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
