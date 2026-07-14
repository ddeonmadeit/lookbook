import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useCartSync } from "@/hooks/useCartSync";
import { usePageTracking } from "@/hooks/usePageTracking";
import { useAdminSession } from "@/hooks/useAdminSession";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAdminThemeStore } from "@/stores/adminThemeStore";
import Index from "./pages/Index";
import ComingSoon from "./pages/ComingSoon";
import loadingSpinner from "@/assets/loading-spinner.gif";

// Route-level code splitting: shoppers landing on / (or the coming-soon gate)
// only download what those views need; heavier pages (product detail, admin
// dashboard, checkout) load on demand.
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const RequireAdmin = lazy(() => import("./pages/admin/RequireAdmin"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Matches the loading state the pages themselves show, so a route chunk
// loading looks no different from a page loading its data.
const RouteFallback = () => (
  <div className="h-full bg-background flex items-center justify-center">
    <img src={loadingSpinner} alt="Loading" className="w-16 h-16 object-contain" />
  </div>
);

const queryClient = new QueryClient();

// While site_mode is "coming_soon", every route except /admin (so the owner
// can still log in, manage products, and flip the switch) shows the
// countdown/early-access page instead of the real storefront. A logged-in
// admin session also bypasses the gate on public routes — lets the owner
// preview the live site from their own browser without exposing it to
// anyone else, who still needs a valid login to see past the gate.
const SiteGate = () => {
  usePageTracking();
  const siteMode = useSettingsStore((s) => s.siteMode);
  const adminTheme = useAdminThemeStore((s) => s.theme);
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");
  // Only worth checking while actually gated — once live, this never gates
  // anything, so skip the auth lookup entirely for ordinary shoppers.
  const isGated = siteMode === "coming_soon" && !isAdminRoute;
  const { hasSession, checked } = useAdminSession();

  // Dark mode is an admin-only preference. Applied here — a single stable
  // component that's never itself lazy-loaded/unmounted — rather than inside
  // the lazy-loaded admin pages, so it can't be left in a stale state by a
  // Suspense/lazy remount race. The public storefront never gets the class.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isAdminRoute && adminTheme === "dark");
  }, [isAdminRoute, adminTheme]);

  if (isGated && !(checked && hasSession)) {
    return <ComingSoon />;
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/product/:handle" element={<ProductDetail />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
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
    </Suspense>
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
