import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface ZoomImage {
  url: string;
  altText?: string | null;
}

interface ProductImageZoomProps {
  images: ZoomImage[];
  initialIndex: number;
  productTitle: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Full-screen lightbox: pinch/wheel to zoom, drag to pan once zoomed, double
 * tap/click to toggle zoom. Renders as a normal (non-portal) child so its own
 * stopPropagation calls are enough to keep the underlying product page's
 * swipe/wheel/keyboard navigation from firing at the same time.
 */
const ProductImageZoom = ({ images, initialIndex, productTitle, onClose }: ProductImageZoomProps) => {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const naturalSize = useRef({ width: 0, height: 0 });
  const gestureAreaRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef({ dist: 0, scale: 1 });
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const translateStart = useRef({ x: 0, y: 0 });
  const gesture = useRef({ hadMultiTouch: false, maxMove: 0, startX: 0, startY: 0 });
  const lastTap = useRef(0);
  const scaleRef = useRef(scale);
  const isGesturing = pointers.current.size > 0;

  const image = images[index];

  const resetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  useEffect(() => {
    resetZoom();
  }, [index]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [images.length, onClose]);

  const clampTranslate = (t: { x: number; y: number }, s: number) => {
    const { width, height } = naturalSize.current;
    const maxX = Math.max(0, (width * s - width) / 2);
    const maxY = Math.max(0, (height * s - height) / 2);
    return { x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) };
  };

  const zoomTo = (targetScale: number) => {
    const s = clamp(targetScale, MIN_SCALE, MAX_SCALE);
    scaleRef.current = s;
    setScale(s);
    setTranslate((t) => (s === MIN_SCALE ? { x: 0, y: 0 } : clampTranslate(t, s)));
  };

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // A native (non-passive) listener so preventDefault actually stops the page
  // from scrolling — React's synthetic onWheel is passive by default.
  useEffect(() => {
    const el = gestureAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      zoomTo(scaleRef.current - e.deltaY * 0.01);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = { hadMultiTouch: false, maxMove: 0, startX: e.clientX, startY: e.clientY };
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = translate;
    } else if (pointers.current.size === 2) {
      gesture.current.hadMultiTouch = true;
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: dist(a, b), scale };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = dist(a, b);
      const next = clamp(pinchStart.current.scale * (d / pinchStart.current.dist), MIN_SCALE, MAX_SCALE);
      setScale(next);
      setTranslate((t) => clampTranslate(t, next));
    } else if (pointers.current.size === 1 && panStart.current) {
      const dx = e.clientX - gesture.current.startX;
      const dy = e.clientY - gesture.current.startY;
      gesture.current.maxMove = Math.max(gesture.current.maxMove, Math.hypot(dx, dy));
      if (scale > 1) {
        const mdx = e.clientX - panStart.current.x;
        const mdy = e.clientY - panStart.current.y;
        setTranslate(clampTranslate({ x: translateStart.current.x + mdx, y: translateStart.current.y + mdy }, scale));
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      const { hadMultiTouch, maxMove } = gesture.current;
      if (e.pointerType === "touch" && !hadMultiTouch && maxMove < 10) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          zoomTo(scale > 1 ? MIN_SCALE : DOUBLE_TAP_SCALE);
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      }
      panStart.current = null;
      if (scale <= MIN_SCALE) resetZoom();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    zoomTo(scale > 1 ? MIN_SCALE : DOUBLE_TAP_SCALE);
  };

  const goTo = (i: number) => setIndex((i + images.length) % images.length);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-background/80 text-foreground border border-border"
        aria-label="Close zoom"
      >
        <X className="w-5 h-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              goTo(index - 1);
            }}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-background/80 text-foreground border border-border"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              goTo(index + 1);
            }}
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-background/80 text-foreground border border-border"
            aria-label="Next image"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      <div
        ref={gestureAreaRef}
        className="w-full h-full flex items-center justify-center overflow-hidden touch-none"
        onClick={(e) => {
          // Only the empty padding around the image closes the overlay —
          // clicking the image itself (e.g. to double-click zoom) must not.
          if (e.target === e.currentTarget && scale === 1) onClose();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {image && (
          <img
            src={image.url}
            alt={image.altText || productTitle}
            className={`max-w-[92%] max-h-[85vh] object-contain select-none ${scale > 1 ? "cursor-grab" : "cursor-zoom-in"}`}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transition: isGesturing ? "none" : "transform 0.2s ease-out",
            }}
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              naturalSize.current = { width: el.offsetWidth, height: el.offsetHeight };
            }}
          />
        )}
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
          {images.map((_, i) => (
            <div
              key={i}
              className={`w-1 h-1 rounded-full transition-colors duration-200 ${
                i === index ? "bg-foreground" : "bg-foreground/30"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductImageZoom;
