import { useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface RestockReminderProps {
  productId: string;
  handle: string;
  title: string;
}

/**
 * Shown on a sold-out product: leave a phone number and get a text when it's
 * back. Deliberately one field and one button — anything more is friction on
 * something the shopper is only doing because they couldn't buy.
 */
const RestockReminder = ({ productId, handle, title }: RestockReminderProps) => {
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.trim();
    if (!cleaned) {
      setError("Enter your phone number.");
      return;
    }

    setState("saving");
    setError("");
    try {
      const { error: insertError } = await supabase.from("restock_reminders").insert({
        product_id: productId,
        product_handle: handle,
        product_title: title,
        phone: cleaned,
      });
      // 23505 = already on the list for this product; that's a success to the
      // shopper, not an error.
      if (insertError && insertError.code !== "23505") {
        setError("Couldn't save that — try again.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Couldn't save that — try again.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <p className="font-body text-[11px] text-muted-foreground text-center py-2">
        We'll text you when it's back.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label
        htmlFor="restock-phone"
        className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground block"
      >
        Remind me
      </label>
      <div className="flex gap-1.5">
        <input
          id="restock-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (error) setError("");
          }}
          placeholder="Phone number"
          className="flex-1 min-w-0 bg-transparent border border-border px-3 py-2 font-body text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
        />
        <button
          type="submit"
          disabled={state === "saving"}
          className="px-4 py-2 font-body text-[10px] uppercase tracking-[0.15em] border border-foreground bg-foreground text-background transition-opacity disabled:opacity-60 flex-shrink-0"
        >
          {state === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Notify"}
        </button>
      </div>
      {error && <p className="font-body text-[10px] text-accent">{error}</p>}
    </form>
  );
};

export default RestockReminder;
