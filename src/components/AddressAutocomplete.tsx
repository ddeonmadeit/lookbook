import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchAddresses, type AddressSuggestion } from "@/lib/addressSearch";

interface Props {
  id: string;
  /** The street line as typed (or as filled from a picked suggestion). */
  value: string;
  country: string;
  onChange: (line1: string) => void;
  onPick: (address: AddressSuggestion) => void;
  placeholder?: string;
}

/**
 * The street-address box at checkout: suggestions appear as you type, and picking one fills the
 * whole address. Typing it out in full, or Safari/Chrome AutoFill, still work as normal.
 */
export function AddressAutocomplete({ id, value, country, onChange, onPick, placeholder }: Props) {
  const listId = useId();
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Only the shopper's own typing searches, never a fill from a picked suggestion.
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!typing || value.trim().length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    const stop = new AbortController();
    const timer = window.setTimeout(() => {
      searchAddresses(value, country, stop.signal)
        .then((found) => {
          setItems(found);
          setActive(-1);
          setOpen(found.length > 0);
        })
        .catch(() => {
          /* offline, or the lookup's down: typing it out still works */
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      stop.abort();
    };
  }, [value, country, typing]);

  const pick = (address: AddressSuggestion) => {
    setTyping(false);
    setOpen(false);
    setItems([]);
    onPick(address);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="shipping address-line1"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setTyping(true);
          onChange(e.target.value);
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="font-body text-[12px]"
      />
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching addresses"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto border border-border bg-background shadow-lg"
        >
          {items.map((a, i) => (
            <li
              key={a.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the box (no blur) so the tap always lands.
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(a)}
              className={`cursor-pointer px-3 py-2.5 ${i === active ? "bg-muted" : "hover:bg-muted/60"}`}
            >
              <span className="block font-body text-[12px]">{a.line1}</span>
              <span className="block font-body text-[10px] text-muted-foreground">
                {[a.city, a.state, a.postcode].filter(Boolean).join(" ")}
              </span>
            </li>
          ))}
          <li role="presentation" className="border-t border-border px-3 py-1.5 font-body text-[9px] text-muted-foreground">
            Addresses © OpenStreetMap contributors
          </li>
        </ul>
      )}
    </div>
  );
}
