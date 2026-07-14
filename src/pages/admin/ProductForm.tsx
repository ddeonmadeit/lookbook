import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ManualImage, ManualOption, ManualVariant, ProductRow } from "@/lib/products";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Cartesian product of the defined options → variant titles + selections. */
function buildCombos(options: ManualOption[]) {
  const real = options
    .map((o) => ({ name: o.name.trim(), values: o.values.filter((v) => v.trim()) }))
    .filter((o) => o.name && o.values.length);

  if (real.length === 0) return [];

  let combos: Array<Array<{ name: string; value: string }>> = [[]];
  for (const opt of real) {
    const next: Array<Array<{ name: string; value: string }>> = [];
    for (const combo of combos) {
      for (const value of opt.values) {
        next.push([...combo, { name: opt.name, value: value.trim() }]);
      }
    }
    combos = next;
  }

  return combos.map((selectedOptions) => ({
    title: selectedOptions.map((s) => s.value).join(" / "),
    selectedOptions,
  }));
}

/**
 * Concrete variants from options + per-variant stock. A blank stock value
 * means "not tracked": availability follows the product's In-stock switch.
 * A numeric stock drives availability automatically (0 = sold out).
 */
function buildVariants(
  options: ManualOption[],
  price: number,
  handle: string,
  available: boolean,
  stockByTitle: Record<string, string>,
): ManualVariant[] {
  return buildCombos(options).map(({ title, selectedOptions }) => {
    const raw = (stockByTitle[title] ?? "").trim();
    const stock = raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    return {
      id: `${handle}::${selectedOptions.map((s) => s.value).join("/")}`,
      title,
      price,
      available: stock !== null ? stock > 0 : available,
      stock,
      selectedOptions,
    };
  });
}

interface ProductFormProps {
  product: ProductRow | null;
  /** Position to give a brand-new product (appended to the end of the grid). */
  nextPosition: number;
  onSaved: () => void;
  onCancel: () => void;
}

const ProductForm = ({ product, nextPosition, onSaved, onCancel }: ProductFormProps) => {
  const [title, setTitle] = useState(product?.title ?? "");
  const [handle, setHandle] = useState(product?.handle ?? "");
  const [handleEdited, setHandleEdited] = useState(!!product);
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(String(product?.price ?? ""));
  const [currency, setCurrency] = useState(product?.currency ?? "USD");
  const [available, setAvailable] = useState(product?.available ?? true);
  const [sortOrder, setSortOrder] = useState(String(product?.sort_order ?? 0));
  const [images, setImages] = useState<ManualImage[]>(product?.images ?? []);
  const [imageUrl, setImageUrl] = useState("");
  const [options, setOptions] = useState<Array<{ name: string; valuesText: string }>>(
    (product?.options ?? []).map((o) => ({ name: o.name, valuesText: o.values.join(", ") })),
  );
  // Per-variant stock, keyed by variant title ("" key = single default variant).
  const [stockByTitle, setStockByTitle] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    (product?.variants ?? []).forEach((v) => {
      const key = v.title === "Default Title" ? "" : v.title;
      map[key] = v.stock === null || v.stock === undefined ? "" : String(v.stock);
    });
    return map;
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (!handleEdited) setHandle(slugify(value));
  };

  const addImageUrl = () => {
    const url = imageUrl.trim();
    if (!url) return;
    setImages((prev) => [...prev, { url, altText: title }]);
    setImageUrl("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${handle || slugify(title) || "product"}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) {
        toast.error("Upload failed", { description: error.message });
        return;
      }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setImages((prev) => [...prev, { url: data.publicUrl, altText: title }]);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const addOption = () => setOptions((prev) => [...prev, { name: "", valuesText: "" }]);
  const updateOption = (idx: number, field: "name" | "valuesText", value: string) =>
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)));
  const removeOption = (idx: number) => setOptions((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    const finalHandle = handle.trim() || slugify(title);
    if (!title.trim() || !finalHandle) {
      toast.error("Title is required");
      return;
    }
    const priceNum = parseFloat(price) || 0;
    const parsedOptions: ManualOption[] = options
      .map((o) => ({
        name: o.name.trim(),
        values: o.valuesText.split(",").map((v) => v.trim()).filter(Boolean),
      }))
      .filter((o) => o.name && o.values.length);

    let variants = buildVariants(parsedOptions, priceNum, finalHandle, available, stockByTitle);
    // No options but a stock number set: create the single default variant so
    // stock can still be tracked.
    if (variants.length === 0 && (stockByTitle[""] ?? "").trim() !== "") {
      const stock = Math.max(0, parseInt(stockByTitle[""], 10) || 0);
      variants = [
        {
          id: `${finalHandle}::default`,
          title: "Default Title",
          price: priceNum,
          available: stock > 0,
          stock,
          selectedOptions: [],
        },
      ];
    }

    const payload = {
      handle: finalHandle,
      title: title.trim(),
      description: description.trim() || null,
      description_html: null,
      price: priceNum,
      currency: currency.trim() || "USD",
      images: images as unknown as Json,
      options: parsedOptions as unknown as Json,
      variants: variants as unknown as Json,
      available,
      sort_order: parseInt(sortOrder, 10) || 0,
      ...(product ? {} : { position: nextPosition }),
    };

    setSaving(true);
    try {
      const query = product
        ? supabase.from("products").update(payload).eq("id", product.id)
        : supabase.from("products").insert(payload);
      const { error } = await query;
      if (error) {
        toast.error("Could not save product", { description: error.message });
        return;
      }
      toast.success(product ? "Product updated" : "Product added");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputLabel = "text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className={inputLabel}>Title *</Label>
          <Input value={title} onChange={(e) => onTitleChange(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className={inputLabel}>Handle (URL slug)</Label>
          <Input
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              setHandleEdited(true);
            }}
            placeholder="auto-generated from title"
          />
        </div>
        <div className="space-y-1.5">
          <Label className={inputLabel}>Price</Label>
          <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className={inputLabel}>Currency</Label>
          <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className={inputLabel}>Display number</Label>
          <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          <p className="font-body text-[10px] text-muted-foreground">
            Shown on the storefront as the zero-padded product number (e.g. 25 →
            "025"). Grid position is set separately from the products list.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-6">
          <Switch checked={available} onCheckedChange={setAvailable} id="available" />
          <Label htmlFor="available" className={inputLabel}>In stock</Label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className={inputLabel}>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>

      {/* Images */}
      <div className="space-y-2">
        <Label className={inputLabel}>Images</Label>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative w-16 h-16 border border-border flex items-center justify-center">
                <img src={img.url} alt={img.altText ?? ""} className="max-w-full max-h-full object-contain" />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Paste image URL"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addImageUrl();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addImageUrl} className="flex-shrink-0">
            Add
          </Button>
        </div>
        <div>
          <input
            type="file"
            accept="image/*"
            id="image-upload"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => document.getElementById("image-upload")?.click()}
            className="text-[11px]"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload file
          </Button>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className={inputLabel}>Options (e.g. Size, Color)</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addOption} className="text-[11px]">
            <Plus className="w-3 h-3 mr-1" /> Add option
          </Button>
        </div>
        {options.map((opt, idx) => (
          <div key={idx} className="flex gap-2 items-start">
            <Input
              value={opt.name}
              onChange={(e) => updateOption(idx, "name", e.target.value)}
              placeholder="Name (Size)"
              className="w-1/3"
            />
            <Input
              value={opt.valuesText}
              onChange={(e) => updateOption(idx, "valuesText", e.target.value)}
              placeholder="Values, comma separated (S, M, L)"
              className="flex-1"
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => removeOption(idx)} className="flex-shrink-0">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        {options.length === 0 && (
          <p className="font-body text-[10px] text-muted-foreground">
            No options — the product is sold as a single variant.
          </p>
        )}
      </div>

      {/* Inventory */}
      <div className="space-y-2">
        <Label className={inputLabel}>Inventory</Label>
        {(() => {
          const combos = buildCombos(
            options.map((o) => ({
              name: o.name,
              values: o.valuesText.split(",").map((v) => v.trim()).filter(Boolean),
            })),
          );
          const rows = combos.length > 0 ? combos.map((c) => c.title) : [""];
          return (
            <div className="space-y-1.5">
              {rows.map((title) => (
                <div key={title || "__default"} className="flex items-center gap-2">
                  <span className="font-body text-[11px] flex-1 truncate">
                    {title || "Stock on hand"}
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="—"
                    className="w-24 text-right"
                    value={stockByTitle[title] ?? ""}
                    onChange={(e) =>
                      setStockByTitle((prev) => ({ ...prev, [title]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <p className="font-body text-[10px] text-muted-foreground leading-relaxed">
                Leave blank to not track stock (availability follows the In-stock switch).
                With a number set, items sell out automatically at 0.
              </p>
            </div>
          );
        })()}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : product ? "Save changes" : "Add product"}
        </Button>
      </div>
    </div>
  );
};

export default ProductForm;
