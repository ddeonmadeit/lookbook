import { useState, useEffect, useRef, useCallback } from "react";
import { type ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { Navbar } from "@/components/Navbar";
import loadingSpinner from "@/assets/loading-spinner.gif";

const COLUMN_STEPS = [5, 4, 3]; // 5 cols (zoom out) → 3 cols (zoom in)
const DEFAULT_INDEX = 2; // 3 columns default

// Exact order from knotsss.com/collections/all
const HANDLE_ORDER = [
  "untitled-oct1_21-14",
  "sttu-teeshirt",
  "crescent-raw-denim",
  "palm-hoodie",
  "the-shoodie®",
  "bulletproof-vest",
  "squid-ink-thermal",
  "the-magnum-opus-leather-jacket",
  "camo-mohair-sweater",
  "crescent-washed-straight-leg-jeans",
  "sea-reactive-hoodies",
  "sea-washed-sweatpants-unisex",
  "cactus-button-up",
  "tan-jorts",
  "pearl-jorts",
  "totem-tee-reversible",
  "flared-1-1-jeans",
  "mohair-knit",
  "patch-switch-hoodie",
  
  "bleko-x-knots-tee",
  "patch-switch-trucker-hat",
  "camo-jersey",
  "tropic-thunder-t-shirt",
  "rippleshorts",
];

const Index = () => {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [creationOrderMap, setCreationOrderMap] = useState<Record<string, string>>({});
  const [colIndex, setColIndex] = useState(DEFAULT_INDEX);
  const minIndex = 0;
  const maxIndex = COLUMN_STEPS.length - 1;

  const lastPinchDist = useRef<number | null>(null);
  const pinchThreshold = 40; // px distance change to trigger column change
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const data = await storefrontApiRequest(PRODUCTS_QUERY, {
          first: 50,
        });
        const edges = data?.data?.products?.edges || [];
        const allProducts = edges.map((edge: { node: ShopifyProduct["node"] }) => ({ node: edge.node }));
        
        // Build a global creation-order map: sort ALL products by createdAt, assign 001, 002, etc.
        const sorted = [...allProducts].sort((a: ShopifyProduct, b: ShopifyProduct) => {
          const dateA = a.node.createdAt || '';
          const dateB = b.node.createdAt || '';
          return dateA.localeCompare(dateB);
        });
        const orderMap: Record<string, string> = {};
        sorted.forEach((p: ShopifyProduct, i: number) => {
          orderMap[p.node.handle] = String(i + 1).padStart(3, '0');
        });
        setCreationOrderMap(orderMap);

        // Filter to only handles in HANDLE_ORDER, then sort by that order
        const handleSet = new Set(HANDLE_ORDER);
        const filtered = allProducts.filter((p: ShopifyProduct) => handleSet.has(p.node.handle));
        filtered.sort((a: ShopifyProduct, b: ShopifyProduct) => 
          HANDLE_ORDER.indexOf(a.node.handle) - HANDLE_ORDER.indexOf(b.node.handle)
        );
        setProducts(filtered);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault(); // Prevent browser pinch-zoom

      if (lastPinchDist.current === null) return;

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = dist - lastPinchDist.current;

      if (Math.abs(delta) > pinchThreshold) {
        if (delta > 0) {
          setColIndex((prev) => Math.min(prev + 1, maxIndex));
        } else {
          setColIndex((prev) => Math.max(prev - 1, minIndex));
        }
        lastPinchDist.current = dist;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
  }, []);

  // Wheel zoom for desktop (ctrl+scroll)
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) {
      setColIndex((prev) => Math.min(prev + 1, maxIndex));
    } else {
      setColIndex((prev) => Math.max(prev - 1, minIndex));
    }
  }, []);

  useEffect(() => {
    document.addEventListener("touchstart", handleTouchStart, { passive: false });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("wheel", handleWheel);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleWheel]);

  const columns = COLUMN_STEPS[colIndex];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <Navbar />
      <div className="h-12" />

      {loading ? (
        <div className="flex items-center justify-center" style={{ height: "calc(100vh - 48px)" }}>
          <img src={loadingSpinner} alt="Loading" className="w-16 h-16 object-contain" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex items-center justify-center" style={{ height: "calc(100vh - 48px)" }}>
          <p className="text-muted-foreground font-body text-[11px] uppercase tracking-[0.15em]">
            No products found
          </p>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid gap-0 transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {products.map((product, i) => (
            <ProductCard key={product.node.id} product={product} index={i} displayNumber={creationOrderMap[product.node.handle]} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Index;
