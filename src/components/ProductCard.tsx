import { useState } from "react";
import { Link } from "react-router-dom";

import { type ShopifyProduct } from "@/lib/shopify";
import loadingSpinner from "@/assets/loading-spinner.gif";

interface ProductCardProps {
  product: ShopifyProduct;
  index: number;
  displayNumber?: string;
}

export const ProductCard = ({ product, index, displayNumber }: ProductCardProps) => {
  const { node } = product;
  const image = node.images.edges[0]?.node;
  const [imageLoaded, setImageLoaded] = useState(false);
  const isSoldOut = node.variants.edges.every(({ node: v }) => !v.availableForSale);

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group block animate-fade-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="flex flex-col items-center px-1 pt-2 pb-3">
        {/* Product image */}
        <div className="w-full aspect-square flex items-center justify-center relative">
          {image ? (
            <>
              {!imageLoaded && (
                <img
                  src={loadingSpinner}
                  alt="Loading"
                  className="absolute w-10 h-10 object-contain"
                />
              )}
              <img
                src={image.url}
                alt={image.altText || node.title}
                className={`max-w-[95%] max-h-[95%] object-contain transition-all duration-500 ease-out group-hover:scale-[1.03] will-change-transform ${
                  imageLoaded ? "opacity-100" : "opacity-0"
                }`}
                loading={index < 9 ? "eager" : "lazy"}
                draggable={false}
                decoding="async"
                onLoad={() => setImageLoaded(true)}
              />
            </>
          ) : (
            <div className="text-muted-foreground text-[10px] uppercase tracking-widest">
              No image
            </div>
          )}
        </div>
        {/* Product name */}
        <p className={`mt-1 text-center font-body text-[11px] sm:text-[13px] tracking-[0.04em] text-foreground ${isSoldOut ? 'line-through decoration-foreground/60' : ''}`}>
          {displayNumber || node.title}
        </p>
      </div>
    </Link>
  );
};
