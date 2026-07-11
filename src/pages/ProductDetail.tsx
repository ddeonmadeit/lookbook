import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { type ShopifyProduct } from "@/lib/shopify";
import { getProducts } from "@/lib/products";
import { useCartStore } from "@/stores/cartStore";
import { Navbar } from "@/components/Navbar";
import { Plus, Minus, Eye, EyeOff, ChevronDown, HelpCircle } from "lucide-react";
import loadingSpinner from "@/assets/loading-spinner.gif";

const MYSTERY_HANDLE = "untitled-oct1_21-14";

const MYSTERY_CAROUSEL_HANDLES = [
  "the-magnum-opus-leather-jacket",
  "camo-mohair-sweater",
  "crescent-raw-denim",
  "bulletproof-vest",
  "crescent-washed-straight-leg-jeans",
  "sttu-teeshirt",
  "tan-jorts",
  "squid-ink-thermal",
  "cactus-button-up",
  "sea-reactive-hoodies",
];

const ProductDetail = () => {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();

  const [allProducts, setAllProducts] = useState<ShopifyProduct[]>([]);
  const [currentProductIndex, setCurrentProductIndex] = useState(0);
  const [product, setProduct] = useState<ShopifyProduct["node"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'up' | 'down' | null>(null);
  const [slidePhase, setSlidePhase] = useState<'idle' | 'out' | 'in'>('idle');
  const [showDetails, setShowDetails] = useState(false);
  const [showMystery, setShowMystery] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lastNavTime = useRef(0);
  const detailsRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef<HTMLDivElement>(null);
  const mysteryRef = useRef<HTMLDivElement>(null);
  const detailsScrollRef = useRef<HTMLDivElement>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);

  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);

  const panelsOpen = showDetails || showSizes || showMystery;

  const initProduct = useCallback((p: ShopifyProduct["node"]) => {
    setProduct(p);
    setCurrentImageIndex(0);
    setImageLoaded(false);
    setShowSizes(false);
    setOpenAccordion(null);
    setShowDetails(false);
    setShowMystery(false);

    const filteredOptions = (p.options || []).filter(o => o.name !== "Title");
    if (filteredOptions.length <= 1) {
      const defaults: Record<string, string> = {};
      filteredOptions.forEach((opt) => { defaults[opt.name] = opt.values[0]; });
      setSelectedOptions(defaults);
    } else {
      setSelectedOptions({});
    }
    window.history.replaceState(null, "", `/product/${p.handle}`);
  }, []);

  useEffect(() => {
    async function fetchAll() {
      try {
        const products = await getProducts();
        setAllProducts(products);

        const idx = products.findIndex((p: ShopifyProduct) => p.node.handle === handle);
        if (idx >= 0) {
          setCurrentProductIndex(idx);
          initProduct(products[idx].node);
        }
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [handle, initProduct]);

  const images = product?.images.edges || [];

  const goToImage = useCallback(
    (direction: 1 | -1) => {
      if (images.length <= 1) return;
      setIsTransitioning(true);
      setImageLoaded(false);
      setTimeout(() => {
        setCurrentImageIndex((prev) => (prev + direction + images.length) % images.length);
        requestAnimationFrame(() => setIsTransitioning(false));
      }, 90);
    },
    [images.length],
  );

  const goToProduct = useCallback(
    (index: number) => {
      if (index < 0 || index >= allProducts.length || isTransitioning) return;
      const now = Date.now();
      if (now - lastNavTime.current < 450) return;
      lastNavTime.current = now;

      const dir = index > currentProductIndex ? 'up' : 'down';
      setSlideDirection(dir);
      setSlidePhase('out');
      setIsTransitioning(true);

      setTimeout(() => {
        setCurrentProductIndex(index);
        initProduct(allProducts[index].node);
        setSlidePhase('in');

        setTimeout(() => {
          setSlidePhase('idle');
          setSlideDirection(null);
          setIsTransitioning(false);
        }, 320);
      }, 280);
    },
    [allProducts, currentProductIndex, initProduct, isTransitioning],
  );

  // Touch handling on the image area
  const handleImageTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const imageSwipeHandled = useRef(false);

  const handleImageTouchEnd = (e: React.TouchEvent) => {
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    imageSwipeHandled.current = false;

    // Horizontal swipe → image gallery
    if (absDeltaX > 40 && absDeltaX > absDeltaY) {
      goToImage(deltaX > 0 ? 1 : -1);
      imageSwipeHandled.current = true;
      return;
    }

    // Vertical swipe on image — always navigate products
    if (absDeltaY > 60 && absDeltaY > absDeltaX) {
      imageSwipeHandled.current = true;
      if (deltaY > 0) {
        // Swipe up on image → next product (or reveal details if not yet open)
        if (!panelsOpen) {
          if (product?.handle === MYSTERY_HANDLE) {
            setShowDetails(true);
            setShowMystery(true);
            setOpenAccordion(null);
          } else {
            setShowDetails(true);
            setOpenAccordion(null);
          }
        } else {
          goToProduct(currentProductIndex + 1);
        }
      } else {
        // Swipe down on image → prev product
        goToProduct(currentProductIndex - 1);
      }
    }
  };

  // Touch handling on the full page (for product navigation when no panels open)
  const pageTouchStartY = useRef(0);
  const handlePageTouchStart = (e: React.TouchEvent) => {
    pageTouchStartY.current = e.touches[0].clientY;
    imageSwipeHandled.current = false;
  };

  const handlePageTouchEnd = (e: React.TouchEvent) => {
    if (panelsOpen || imageSwipeHandled.current) {
      imageSwipeHandled.current = false;
      return;
    }

    const deltaY = pageTouchStartY.current - e.changedTouches[0].clientY;

    if (deltaY > 60) {
      goToProduct(currentProductIndex + 1);
    } else if (deltaY < -60) {
      goToProduct(currentProductIndex - 1);
    }
  };

  // Wheel handler: scroll down = next, scroll up = prev (when no panels open)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (isTransitioning) {
        e.preventDefault();
        return;
      }

      const isOnImage = imageAreaRef.current?.contains(e.target as Node);

      // Horizontal → image gallery (always)
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastNavTime.current < 260) return;
        lastNavTime.current = now;
        goToImage((e.deltaX || e.deltaY) > 0 ? 1 : -1);
        return;
      }

      // When panels open, only navigate if scrolling on the image area
      if (panelsOpen && !isOnImage) return;
      if (Math.abs(e.deltaY) < 8) return;

      e.preventDefault();

      if (e.deltaY > 0) {
        goToProduct(currentProductIndex + 1);
      } else {
        goToProduct(currentProductIndex - 1);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [currentProductIndex, goToImage, goToProduct, isTransitioning, panelsOpen]);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goToImage(-1);
      if (e.key === "ArrowRight") goToImage(1);
      if (e.key === "ArrowUp") { e.preventDefault(); goToProduct(currentProductIndex - 1); }
      if (e.key === "ArrowDown") { e.preventDefault(); goToProduct(currentProductIndex + 1); }
      if (e.key === "Escape") {
        if (showSizes) setShowSizes(false);
        else if (showDetails) setShowDetails(false);
        else if (showMystery) setShowMystery(false);
        else navigate("/");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentProductIndex, goToImage, goToProduct, navigate, showSizes, showDetails, showMystery]);

  const getVariantForOptions = (options: Record<string, string>) => {
    if (!product) return null;
    return product.variants.edges.find(({ node }) =>
      node.selectedOptions.every((opt) => options[opt.name] === opt.value),
    )?.node;
  };

  const handleOptionSelect = async (optionName: string, value: string) => {
    const newOptions = { ...selectedOptions, [optionName]: value };
    setSelectedOptions(newOptions);

    const requiredOptions = (product?.options || []).filter(o => o.name !== "Title");
    const allSelected = requiredOptions.every(opt => newOptions[opt.name]);
    if (!allSelected) return;

    const variant = getVariantForOptions(newOptions);
    if (!variant || !product || !variant.availableForSale) return;

    await addItem({
      product: { node: product },
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions,
    });

    const msg = `${product.title} — ${requiredOptions.map(o => newOptions[o.name]).join(" / ")}`;
    setAddedMessage(msg);
    setTimeout(() => {
      setAddedMessage(null);
      setShowSizes(false);
    }, 700);
  };

  const toggleSizes = () => {
    setShowSizes((prev) => {
      const next = !prev;
      if (next) {
        setSelectedOptions({});
      }
      return next;
    });
  };

  const toggleDetails = () => {
    setShowDetails((prev) => {
      const next = !prev;
      if (next) {
        setOpenAccordion("both");
      } else {
        setOpenAccordion(null);
      }
      return next;
    });
  };

  const toggleMystery = () => {
    setShowMystery((prev) => !prev);
  };

  if (loading) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <img src={loadingSpinner} alt="Loading" className="w-16 h-16 object-contain" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="h-full bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-[11px] font-body uppercase tracking-[0.15em]">Product not found</p>
        <button onClick={() => navigate("/")} className="text-[11px] underline text-muted-foreground font-body">Back</button>
      </div>
    );
  }

  const image = images[currentImageIndex]?.node;
  const price = parseFloat(product.priceRange.minVariantPrice.amount).toFixed(0);
  

  return (
    <div
      className="h-full bg-background select-none flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]"
      onTouchStart={handlePageTouchStart}
      onTouchEnd={handlePageTouchEnd}
    >
      {/* Header */}
      <div className="relative z-40">
        <Navbar sticky={false} />
      </div>

      {/* Main content — scrollable when panels open */}
      <div
        className={`flex-1 flex flex-col relative ${panelsOpen ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'}`}
        onWheel={panelsOpen ? (e) => e.stopPropagation() : undefined}
      >
        {/* Image area — shrinks when panels open */}
        <div
          ref={imageAreaRef}
          className={`flex flex-col items-center justify-center px-6 touch-none relative transition-all duration-300 ease-out flex-shrink-0 ${
            panelsOpen ? '' : 'flex-1'
          }`}
          style={panelsOpen ? { height: '45vh' } : undefined}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
        >
          <div className="flex items-center justify-center w-full flex-1 relative overflow-hidden">
            {!imageLoaded && slidePhase === 'idle' && (
              <img
                src={loadingSpinner}
                alt="Loading"
                className="absolute w-12 h-12 object-contain"
              />
            )}
            {image && (
              <img
                key={`${product.handle}-${currentImageIndex}`}
                src={image.url}
                alt={image.altText || product.title}
                className={`max-w-[90%] object-contain transition-[max-height] duration-300 ease-out ${panelsOpen ? 'max-h-[38vh]' : 'max-h-[65vh]'}`}
                style={{
                  transition: slidePhase === 'idle' ? 'opacity 0.3s ease-out, max-height 0.3s ease-out' : 
                    slidePhase === 'out' ? 'transform 0.28s cubic-bezier(0.4, 0, 1, 1), opacity 0.28s ease-out' :
                    'transform 0.32s cubic-bezier(0, 0, 0.2, 1), opacity 0.32s ease-in',
                  transform: slidePhase === 'out' 
                    ? `translateY(${slideDirection === 'up' ? '-105%' : '105%'})` 
                    : 'translateY(0)',
                  opacity: slidePhase === 'out' ? 0 : !imageLoaded && slidePhase === 'idle' ? 0 : 1,
                }}
                draggable={false}
                loading="eager"
                decoding="async"
                onLoad={() => setImageLoaded(true)}
                ref={(el) => {
                  if (el && slidePhase === 'in') {
                    el.style.transition = 'none';
                    el.style.transform = `translateY(${slideDirection === 'up' ? '80%' : '-80%'})`;
                    el.style.opacity = '0';
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        el.style.transition = 'transform 0.32s cubic-bezier(0, 0, 0.2, 1), opacity 0.32s ease-in';
                        el.style.transform = 'translateY(0)';
                        el.style.opacity = '1';
                      });
                    });
                  }
                }}
              />
            )}
          </div>
          {images.length > 1 && (
            <div className="flex justify-center gap-1.5 pb-2">
              {images.map((_, i) => (
                <div
                  key={i}
                  className={`w-1 h-1 rounded-full transition-colors duration-200 ${
                    i === currentImageIndex ? "bg-foreground" : "bg-foreground/20"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bottom bar — product name, price, action buttons — always visible */}
        <div className="bg-background px-5 pt-2 pb-2 relative z-10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 pr-3 overflow-hidden">
              <div
                style={{
                  transition: slidePhase === 'out' ? 'transform 0.28s cubic-bezier(0.4, 0, 1, 1), opacity 0.28s ease-out' :
                    slidePhase === 'in' ? 'transform 0.32s cubic-bezier(0, 0, 0.2, 1), opacity 0.32s ease-in' : 'none',
                  transform: slidePhase === 'out' ? `translateY(${slideDirection === 'up' ? '-100%' : '100%'})` : 'translateY(0)',
                  opacity: slidePhase === 'out' ? 0 : 1,
                }}
              >
                <p className="font-body text-[11px] uppercase tracking-[0.1em] truncate">{product.title}</p>
                <p className="font-body text-[10px] text-muted-foreground">${price}</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={toggleSizes}
                className="w-9 h-9 flex items-center justify-center text-foreground active:scale-90 transition-transform"
                aria-label={showSizes ? "Hide options" : "Show options"}
              >
                {showSizes ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>
              <button
                onClick={toggleDetails}
                className="w-9 h-9 flex items-center justify-center text-foreground active:scale-90 transition-transform"
                aria-label={showDetails ? "Hide details" : "Show details"}
              >
                {showDetails ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              {product.handle === MYSTERY_HANDLE && (
                <button
                  onClick={toggleMystery}
                  className="w-9 h-9 flex items-center justify-center text-foreground active:scale-90 transition-transform"
                  aria-label={showMystery ? "Hide mystery items" : "Show mystery items"}
                >
                  <HelpCircle className={`h-4 w-4 ${showMystery ? "text-accent" : ""}`} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Panels — in normal flow, push content up */}
        {panelsOpen && (
          <div className="flex-shrink-0 animate-[fade-in_0.2s_ease-out]">
            {/* Sizes panel */}
            {showSizes && (
              <div ref={sizesRef} className="bg-background border-t border-border p-5 relative overflow-hidden">
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-background z-10 transition-opacity duration-200 ease-out ${
                    addedMessage ? "opacity-100" : "opacity-0 pointer-events-none"
                  }`}
                >
                  <p className="font-body text-[11px] uppercase tracking-[0.15em] text-foreground">
                    Added to Bag
                  </p>
                </div>

                <div className={`transition-opacity duration-150 ease-out ${addedMessage ? "opacity-0" : "opacity-100"}`}>
                  {(() => {
                    const allVariantsSoldOut = product.variants.edges.every(({ node: v }) => !v.availableForSale);
                    const filteredOptions = product.options?.filter((o) => o.name !== "Title") || [];
                    const displayOptions = allVariantsSoldOut
                      ? [filteredOptions.find(o => /colou?r/i.test(o.name)) || filteredOptions[0]].filter(Boolean)
                      : filteredOptions;

                    return (
                      <>
                        {allVariantsSoldOut ? (
                          <div className="flex items-center justify-center py-3">
                            <p className="font-display text-[18px] font-semibold text-accent uppercase tracking-[0.15em]">
                              SOLD OUT
                            </p>
                          </div>
                        ) : (
                          <>
                            {displayOptions.map((option) => (
                              <div key={option.name} className="mb-3">
                                <label className="font-body text-[10px] font-medium text-muted-foreground mb-2 block uppercase tracking-[0.15em]">
                                  {option.name}
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {option.values.map((value) => {
                                    const testOpts = { ...selectedOptions, [option.name]: value };
                                    const variant = getVariantForOptions(testOpts);
                                    const available = variant?.availableForSale !== false;
                                    const isSelected = selectedOptions[option.name] === value;

                                    return (
                                      <button
                                        key={value}
                                        onClick={() => handleOptionSelect(option.name, value)}
                                        disabled={!available || isLoading}
                                        className={`px-3 py-1.5 text-[10px] font-body border transition-all duration-150 active:scale-95 ${
                                          !available
                                            ? "border-border text-muted-foreground cursor-not-allowed"
                                            : isSelected
                                              ? "bg-foreground text-background border-foreground"
                                              : "bg-transparent text-foreground border-border hover:border-foreground"
                                        }`}
                                      >
                                        {value}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                        {isLoading && !allVariantsSoldOut && (
                          <div className="flex justify-center py-2">
                            <img src={loadingSpinner} alt="Loading" className="w-8 h-8 object-contain" />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Details section */}
            {showDetails && (
              <div ref={detailsRef} className="bg-background">
                <div className="border-t border-border">
                  <button
                    onClick={() => setOpenAccordion(openAccordion === "stats" || openAccordion === "both" ? null : "stats")}
                    className="w-full flex items-center justify-between px-5 py-4 font-body text-[13px] uppercase tracking-[0.08em] text-foreground"
                  >
                    STATS
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${openAccordion === "stats" || openAccordion === "both" ? "rotate-180" : ""}`} />
                  </button>
                  {(openAccordion === "stats" || openAccordion === "both") && (
                    <div className="px-5 pb-4">
                      {product.descriptionHtml ? (
                        <div
                          className="font-body text-[11px] text-muted-foreground leading-relaxed prose-sm [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_strong]:text-foreground"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(product.descriptionHtml) }}
                        />
                      ) : (
                        <p className="font-body text-[11px] text-muted-foreground leading-relaxed">
                          {product.description || "No details available."}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="border-t border-border border-b">
                  <button
                    onClick={() => setOpenAccordion(openAccordion === "shipping" || openAccordion === "both" ? null : "shipping")}
                    className="w-full flex items-center justify-between px-5 py-4 font-body text-[13px] uppercase tracking-[0.08em] text-foreground"
                  >
                    SHIPPING
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${openAccordion === "shipping" || openAccordion === "both" ? "rotate-180" : ""}`} />
                  </button>
                  {(openAccordion === "shipping" || openAccordion === "both") && (
                    <div className="px-5 pb-4">
                      <p className="font-body text-[11px] text-muted-foreground leading-relaxed">
                        Our estimated domestic shipping time is <strong className="text-foreground">7-12 days</strong> depending on delays.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Mystery carousel */}
            {showMystery && product.handle === MYSTERY_HANDLE && (() => {
              const carouselItems = MYSTERY_CAROUSEL_HANDLES
                .map(h => allProducts.find(p => p.node.handle === h))
                .filter(Boolean) as ShopifyProduct[];
              const doubled = [...carouselItems, ...carouselItems];
              return (
                <div ref={mysteryRef} className="bg-background border-t border-border py-4">
                  <div className="overflow-hidden">
                    <div className="flex w-max animate-mystery-scroll">
                      {doubled.map((p, i) => {
                        const img = p.node.images.edges[0]?.node;
                        return (
                          <div key={`${p.node.id}-${i}`} className="flex-shrink-0 w-[86px] px-[6px]">
                            <div className="w-20 h-20 flex items-center justify-center">
                              {img && (
                                <img
                                  src={img.url}
                                  alt={img.altText || p.node.title}
                                  className="max-w-full max-h-full object-contain"
                                  draggable={false}
                                />
                              )}
                            </div>
                            <p className="font-body text-[8px] text-muted-foreground text-center mt-1 truncate">
                              ${parseFloat(p.node.priceRange.minVariantPrice.amount).toFixed(0)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Vertical product indicator */}
      {allProducts.length > 1 && !panelsOpen && (
        <div className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1">
          {allProducts.map((_, i) => (
            <div
              key={i}
              className={`w-[3px] transition-all duration-300 rounded-full ${
                i === currentProductIndex ? "h-4 bg-foreground" : "h-1 bg-foreground/15"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductDetail;
