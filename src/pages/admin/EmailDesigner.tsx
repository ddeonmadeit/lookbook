import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GripVertical,
  Trash2,
  Copy,
  Plus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  ADDABLE,
  BLOCK_META,
  FONT_CHOICES,
  newBlock,
  type Align,
  type Block,
  type BlockType,
  type EmailDesign,
} from "@/lib/emailDesign";

/* -------------------------------------------------------------------------- */
/* One row in the canvas                                                       */
/* -------------------------------------------------------------------------- */

const SortableBlock = ({
  block,
  selected,
  onSelect,
  onDelete,
  onDuplicate,
  onMove,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const meta = BLOCK_META[block.type];
  const summary =
    block.type === "text" || block.type === "heading" || block.type === "footer"
      ? (block.text ?? "").replace(/<[^>]+>/g, "").slice(0, 60)
      : block.type === "button"
        ? block.text
        : block.type === "image"
          ? block.url || "No image URL yet"
          : meta.hint;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 border rounded-md px-2 py-2 bg-background ${
        selected ? "border-foreground" : "border-border"
      } ${isDragging ? "opacity-60 shadow-lg" : ""}`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none p-1"
        aria-label={`Drag ${meta.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <button type="button" onClick={onSelect} className="flex-1 min-w-0 text-left">
        <span className="block font-body text-[11px] uppercase tracking-[0.1em]">{meta.label}</span>
        <span className="block font-body text-[10px] text-muted-foreground truncate">
          {summary}
        </span>
      </button>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
          aria-label="Move up" onClick={() => onMove(-1)}>
          <ArrowUp className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
          aria-label="Move down" onClick={() => onMove(1)}>
          <ArrowDown className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
          aria-label={`Duplicate ${meta.label}`} onClick={onDuplicate}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
          aria-label={`Delete ${meta.label}`} onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Inspector                                                                   */
/* -------------------------------------------------------------------------- */

const label = "text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground";

const ColourField = ({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  title: string;
}) => (
  <div className="space-y-1.5">
    <Label className={label}>{title}</Label>
    <div className="flex gap-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={title}
        className="h-9 w-10 rounded border border-border bg-transparent p-0.5 cursor-pointer"
      />
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 text-[12px] flex-1" />
    </div>
  </div>
);

const AlignField = ({ value, onChange }: { value: Align; onChange: (v: Align) => void }) => (
  <div className="space-y-1.5">
    <Label className={label}>Align</Label>
    <div className="flex gap-1">
      {([
        ["left", AlignLeft],
        ["center", AlignCenter],
        ["right", AlignRight],
      ] as const).map(([key, Icon]) => (
        <Button
          key={key}
          type="button"
          size="icon"
          variant={value === key ? "secondary" : "ghost"}
          aria-label={`Align ${key}`}
          aria-pressed={value === key}
          className="h-8 w-8"
          onClick={() => onChange(key)}
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
      ))}
    </div>
  </div>
);

const NumberField = ({
  title,
  value,
  onChange,
  min = 0,
  max = 200,
  step = 1,
}: {
  title: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) => (
  <div className="space-y-1.5">
    <Label className={label}>{title}</Label>
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 text-[12px]"
    />
  </div>
);

const BlockInspector = ({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
}) => {
  const t = block.type;
  const hasType = t === "heading" || t === "text" || t === "footer";

  return (
    <div className="space-y-3">
      <p className="font-body text-[11px] uppercase tracking-[0.12em]">{BLOCK_META[t].label}</p>

      {hasType && (
        <div className="space-y-1.5">
          <Label htmlFor="blk-text" className={label}>Text</Label>
          <Textarea
            id="blk-text"
            value={block.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={4}
            className="text-[12px]"
          />
        </div>
      )}

      {t === "button" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="blk-label" className={label}>Button label</Label>
            <Input id="blk-label" value={block.text ?? ""}
              onChange={(e) => onChange({ text: e.target.value })} className="h-9 text-[12px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blk-href" className={label}>Links to</Label>
            <Input id="blk-href" value={block.href ?? ""} placeholder="https://knotsss.com"
              onChange={(e) => onChange({ href: e.target.value })} className="h-9 text-[12px]" />
          </div>
          <ColourField title="Button colour" value={block.background ?? "#2b1d14"}
            onChange={(v) => onChange({ background: v })} />
          <ColourField title="Label colour" value={block.color ?? "#faf4ef"}
            onChange={(v) => onChange({ color: v })} />
          <NumberField title="Corner radius (px)" value={block.radius ?? 0} max={40}
            onChange={(v) => onChange({ radius: v })} />
        </>
      )}

      {t === "image" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="blk-url" className={label}>Image URL</Label>
            <Input id="blk-url" value={block.url ?? ""} placeholder="https://…/banner.jpg"
              onChange={(e) => onChange({ url: e.target.value })} className="h-9 text-[12px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blk-imghref" className={label}>Links to (optional)</Label>
            <Input id="blk-imghref" value={block.href ?? ""}
              onChange={(e) => onChange({ href: e.target.value })} className="h-9 text-[12px]" />
          </div>
        </>
      )}

      {(t === "logo" || t === "image") && (
        <NumberField title="Width (px)" value={block.width ?? 64} min={16} max={600}
          onChange={(v) => onChange({ width: v })} />
      )}

      {t === "spacer" && (
        <NumberField title="Height (px)" value={block.height ?? 24} max={200}
          onChange={(v) => onChange({ height: v })} />
      )}

      {t === "divider" && (
        <ColourField title="Line colour" value={block.color ?? "#e3d8cd"}
          onChange={(v) => onChange({ color: v })} />
      )}

      {(hasType || t === "button") && (
        <NumberField title="Text size (px)" value={block.size ?? 13} min={8} max={48}
          onChange={(v) => onChange({ size: v })} />
      )}

      {hasType && (
        <>
          <ColourField title="Text colour" value={block.color ?? "#2b1d14"}
            onChange={(v) => onChange({ color: v })} />
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 font-body text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!block.uppercase}
                onChange={(e) => onChange({ uppercase: e.target.checked })} className="accent-current" />
              Uppercase
            </label>
            <label className="flex items-center gap-1.5 font-body text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!block.bold}
                onChange={(e) => onChange({ bold: e.target.checked })} className="accent-current" />
              Bold
            </label>
          </div>
          <NumberField title="Letter spacing (em)" value={block.tracking ?? 0} max={1} step={0.01}
            onChange={(v) => onChange({ tracking: v })} />
        </>
      )}

      {t !== "spacer" && (
        <AlignField value={(block.align ?? "left") as Align} onChange={(v) => onChange({ align: v })} />
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumberField title="Space above" value={block.paddingTop ?? 0}
          onChange={(v) => onChange({ paddingTop: v })} />
        <NumberField title="Space below" value={block.paddingBottom ?? 0}
          onChange={(v) => onChange({ paddingBottom: v })} />
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* The designer                                                                */
/* -------------------------------------------------------------------------- */

const EmailDesigner = ({
  design,
  onChange,
  previewHtml,
}: {
  design: EmailDesign;
  onChange: (next: EmailDesign) => void;
  previewHtml: string;
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(design.blocks[0]?.id ?? null);
  const [tab, setTab] = useState<"block" | "theme">("block");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selected = useMemo(
    () => design.blocks.find((b) => b.id === selectedId) ?? null,
    [design.blocks, selectedId],
  );

  const setBlocks = (blocks: Block[]) => onChange({ ...design, blocks });

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = design.blocks.findIndex((b) => b.id === active.id);
    const to = design.blocks.findIndex((b) => b.id === over.id);
    if (from < 0 || to < 0) return;
    setBlocks(arrayMove(design.blocks, from, to));
  };

  const move = (id: string, direction: -1 | 1) => {
    const from = design.blocks.findIndex((b) => b.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= design.blocks.length) return;
    setBlocks(arrayMove(design.blocks, from, to));
  };

  const add = (type: BlockType) => {
    const block = newBlock(type);
    const at = selectedId ? design.blocks.findIndex((b) => b.id === selectedId) + 1 : design.blocks.length;
    const next = [...design.blocks];
    next.splice(at, 0, block);
    setBlocks(next);
    setSelectedId(block.id);
    setTab("block");
  };

  const duplicate = (id: string) => {
    const at = design.blocks.findIndex((b) => b.id === id);
    if (at < 0) return;
    const copy = { ...design.blocks[at], id: newBlock(design.blocks[at].type).id };
    const next = [...design.blocks];
    next.splice(at + 1, 0, copy);
    setBlocks(next);
    setSelectedId(copy.id);
  };

  const remove = (id: string) => {
    setBlocks(design.blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const patchBlock = (patch: Partial<Block>) => {
    if (!selected) return;
    setBlocks(design.blocks.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
  };

  const patchTheme = (patch: Partial<EmailDesign["theme"]>) =>
    onChange({ ...design, theme: { ...design.theme, ...patch } });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Canvas + live preview */}
      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={label}>Blocks — drag to reorder</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add block
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {ADDABLE.map((type) => (
                <DropdownMenuItem key={type} onClick={() => add(type)} className="flex-col items-start gap-0">
                  <span className="font-body text-[12px]">{BLOCK_META[type].label}</span>
                  <span className="font-body text-[10px] text-muted-foreground">
                    {BLOCK_META[type].hint}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={design.blocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {design.blocks.map((b) => (
                <SortableBlock
                  key={b.id}
                  block={b}
                  selected={b.id === selectedId}
                  onSelect={() => { setSelectedId(b.id); setTab("block"); }}
                  onDelete={() => remove(b.id)}
                  onDuplicate={() => duplicate(b.id)}
                  onMove={(d) => move(b.id, d)}
                />
              ))}
              {design.blocks.length === 0 && (
                <p className="font-body text-[12px] text-muted-foreground py-8 text-center border border-dashed border-border rounded-md">
                  Empty — add a block to start.
                </p>
              )}
            </div>
          </SortableContext>
        </DndContext>

        <div className="space-y-1.5">
          <p className={label}>Live preview</p>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={previewHtml}
            className="w-full h-[560px] border border-border rounded-md bg-white"
          />
        </div>
      </div>

      {/* Inspector */}
      <div className="border border-border rounded-md p-3 h-fit lg:sticky lg:top-4">
        <div className="flex gap-1 mb-3">
          <Button type="button" size="sm" variant={tab === "block" ? "secondary" : "ghost"}
            className="h-7 text-[10px] flex-1" onClick={() => setTab("block")}>
            Block
          </Button>
          <Button type="button" size="sm" variant={tab === "theme" ? "secondary" : "ghost"}
            className="h-7 text-[10px] flex-1" onClick={() => setTab("theme")}>
            Theme
          </Button>
        </div>

        {tab === "theme" ? (
          <div className="space-y-3">
            <ColourField title="Page background" value={design.theme.background}
              onChange={(v) => patchTheme({ background: v, contentBackground: v })} />
            <ColourField title="Text" value={design.theme.text}
              onChange={(v) => patchTheme({ text: v })} />
            <ColourField title="Secondary text" value={design.theme.muted}
              onChange={(v) => patchTheme({ muted: v })} />
            <ColourField title="Small print" value={design.theme.faint}
              onChange={(v) => patchTheme({ faint: v })} />
            <ColourField title="Lines" value={design.theme.rule}
              onChange={(v) => patchTheme({ rule: v })} />
            <div className="space-y-1.5">
              <Label className={label}>Font</Label>
              <Select value={design.theme.fontFamily} onValueChange={(v) => patchTheme({ fontFamily: v })}>
                <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_CHOICES.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-[12px]">{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="font-body text-[10px] text-muted-foreground">
                Only fonts already on the reader's device — email can't load web fonts reliably.
              </p>
            </div>
            <NumberField title="Content width (px)" value={design.theme.contentWidth} min={320} max={700}
              onChange={(v) => patchTheme({ contentWidth: v })} />
          </div>
        ) : selected ? (
          <BlockInspector block={selected} onChange={patchBlock} />
        ) : (
          <p className="font-body text-[11px] text-muted-foreground py-6 text-center">
            Pick a block to style it.
          </p>
        )}
      </div>
    </div>
  );
};

export default EmailDesigner;
