import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingContactsSetup } from "@/lib/contacts";

const db = supabase as unknown as SupabaseClient;
const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0];

/**
 * The one-time database update contacts need, for when it hasn't been run
 * yet: copy the SQL, run it in Supabase, come back.
 */
const ContactsSetup = ({ onReady }: { onReady?: () => void }) => {
  const [sql, setSql] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showSql, setShowSql] = useState(false);

  // Loaded up front so Copy works within the tap (iPhones only allow copying then).
  useEffect(() => {
    import("../../../supabase/migrations/20261010120000_contacts.sql?raw").then((m) => setSql(m.default));
  }, []);

  const copy = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      toast.success("Copied — now paste it in Supabase");
    } catch {
      setShowSql(true);
    }
  };

  const check = async () => {
    setChecking(true);
    const { error } = await db.from("contacts").select("id", { head: true, count: "exact" });
    setChecking(false);
    if (!error) {
      toast.success("Contacts are ready");
      onReady?.();
    } else if (isMissingContactsSetup(error)) {
      toast.error("Not set up yet", { description: "Paste the copied update into Supabase's SQL editor and tap Run." });
    } else {
      toast.error("Couldn't check", { description: error.message });
    }
  };

  const step = "font-body text-[12px] leading-relaxed";
  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <p className="font-body text-[13px] font-medium">One-time setup for contacts</p>
      <p className="font-body text-[12px] text-muted-foreground leading-relaxed">
        Your database needs a one-off update before it can keep your contact list (it's what makes sure nobody is ever
        listed twice). It takes about a minute:
      </p>
      <ol className="list-decimal pl-5 space-y-1.5">
        <li className={step}>Tap Copy update.</li>
        <li className={step}>Open the Supabase SQL editor and sign in if asked.</li>
        <li className={step}>Paste, then tap Run.</li>
        <li className={step}>Come back here and tap Check again.</li>
      </ol>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={copy} disabled={!sql} className="max-sm:h-11">
          {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
          {copied ? "Copied" : "Copy update"}
        </Button>
        <Button variant="outline" asChild className="max-sm:h-11">
          <a href={`https://supabase.com/dashboard/project/${projectRef}/sql/new`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-1.5" />
            Open SQL editor
          </a>
        </Button>
        <Button variant="outline" onClick={check} disabled={checking} className="max-sm:h-11">
          {checking && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          Check again
        </Button>
      </div>
      {showSql && sql && (
        <textarea
          readOnly
          value={sql}
          rows={6}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full font-mono text-[11px] border border-border rounded-md p-2 bg-muted/30"
          aria-label="Database update to copy"
        />
      )}
    </div>
  );
};

export default ContactsSetup;
