import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, Code, RotateCcw, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import EmailDesigner from "./EmailDesigner";
import { compileDesign, defaultDesign, type EmailDesign } from "@/lib/emailDesign";

interface TemplateRow {
  key: string;
  name: string;
  description: string | null;
  subject: string;
  html: string;
  sms_body: string | null;
  enabled: boolean;
  /** Block layout, when this template was built in the designer. */
  design: EmailDesign | null;
}

/**
 * Sample values for the preview. Deliberately concrete rather than showing raw
 * {{tokens}} — the point of the preview is to see what a customer sees.
 */
const SAMPLE: Record<string, string> = {
  logo_url: `${window.location.origin}${import.meta.env.BASE_URL}logo-email.png`,
  site_url: "https://knotsss.com",
  order_number: "KN-3F9A12C4",
  customer_name: "Alex Rivera",
  customer_first_name: "Alex",
  customer_email: "alex@example.com",
  customer_phone: "+61 400 000 000",
  items_html:
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#2b1d14;">1 &times; Cable Knit Vest<div style="font-size:11px;color:#9b8878;">Ecru / M</div></td>' +
    '<td align="right" style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#2b1d14;">AUD 180.00</td></tr></table>',
  items_text: "1 x Cable Knit Vest",
  subtotal: "AUD 180.00",
  shipping: "AUD 18.10",
  total: "AUD 198.10",
  shipping_service: "Standard",
  shipping_address_html: "Alex Rivera<br />12 Renwick Street<br />Redfern NSW 2016<br />AU",
  shipping_address_text: "12 Renwick Street, Redfern NSW 2016, AU",
  tracking_number: "33ABC1234567890",
  tracking_carrier: "Australia Post",
  tracking_block:
    '<tr><td style="padding-bottom:22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3d8cd;">' +
    '<tr><td style="padding:14px 16px;font-family:Helvetica,Arial,sans-serif;">' +
    '<div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#9b8878;padding-bottom:5px;">Tracking &middot; Australia Post</div>' +
    '<div style="font-size:15px;letter-spacing:0.06em;color:#2b1d14;">33ABC1234567890</div>' +
    "</td></tr></table></td></tr>",
  tracking_sms: "Tracking: 33ABC1234567890 (Australia Post)",
};

/** The same substitution the send function does, so the preview is honest. */
function render(body: string) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => SAMPLE[key] ?? "");
}

const PLACEHOLDERS = Object.keys(SAMPLE);

const EmailTemplatesTab = () => {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TemplateRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"design" | "preview" | "code">("design");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .order("key");
    if (error) {
      toast.error("Failed to load templates", { description: error.message });
      setLoading(false);
      return;
    }
    // A template with a block layout renders from that layout, not from
    // whatever HTML happens to be stored: the two can only disagree if the
    // stored copy is stale, and saving writes the correct one back.
    const rows = ((data as unknown as TemplateRow[]) || []).map((t) =>
      t.design ? { ...t, html: compileDesign(t.design, t.subject) } : t,
    );
    setTemplates(rows);
    setDrafts(Object.fromEntries(rows.map((t) => [t.key, { ...t }])));
    setActiveKey((k) => k ?? rows[0]?.key ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = activeKey ? drafts[activeKey] : null;
  const saved = useMemo(
    () => templates.find((t) => t.key === activeKey) ?? null,
    [templates, activeKey],
  );
  const dirty =
    !!active &&
    !!saved &&
    (active.subject !== saved.subject ||
      active.html !== saved.html ||
      (active.sms_body ?? "") !== (saved.sms_body ?? "") ||
      active.enabled !== saved.enabled ||
      JSON.stringify(active.design) !== JSON.stringify(saved.design));

  const edit = (field: keyof TemplateRow, value: string | boolean) => {
    if (!activeKey) return;
    setDrafts((d) => ({ ...d, [activeKey]: { ...d[activeKey], [field]: value } }));
  };

  /**
   * Editing the design recompiles the HTML; editing the HTML by hand detaches
   * the design, so the designer can never silently overwrite hand-written
   * markup with a layout that no longer matches it.
   */
  const editDesign = (next: EmailDesign) => {
    if (!activeKey) return;
    setDrafts((d) => ({
      ...d,
      [activeKey]: {
        ...d[activeKey],
        design: next,
        html: compileDesign(next, d[activeKey].subject),
      },
    }));
  };

  const editHtml = (html: string) => {
    if (!activeKey) return;
    setDrafts((d) => ({ ...d, [activeKey]: { ...d[activeKey], html, design: null } }));
  };

  const startDesigning = () => {
    if (!activeKey) return;
    const base = defaultDesign(activeKey);
    setDrafts((d) => ({
      ...d,
      [activeKey]: { ...d[activeKey], design: base, html: compileDesign(base, d[activeKey].subject) },
    }));
    setMode("design");
  };

  const save = async () => {
    if (!active) return;
    setSavingKey(active.key);
    const { error } = await supabase
      .from("email_templates")
      .update({
        subject: active.subject,
        html: active.html,
        sms_body: active.sms_body?.trim() ? active.sms_body : null,
        enabled: active.enabled,
        design: active.design,
      })
      .eq("key", active.key);
    setSavingKey(null);
    if (error) {
      toast.error("Could not save template", { description: error.message });
      return;
    }
    setTemplates((ts) => ts.map((t) => (t.key === active.key ? { ...active } : t)));
    toast.success(`${active.name} saved`);
  };

  const revert = () => {
    if (!saved) return;
    setDrafts((d) => ({ ...d, [saved.key]: { ...saved } }));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!active) {
    return (
      <p className="font-body text-[12px] text-muted-foreground py-8">
        No templates found. Re-run the database migrations to seed them.
      </p>
    );
  }

  const label = "text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground";

  return (
    <div className="space-y-4">
      <div>
        <p className="font-body text-[11px] uppercase tracking-[0.12em]">Automatic emails &amp; texts</p>
        <p className="font-body text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Everything sent automatically to customers. Edit the HTML however you like — the
          preview shows exactly what they'll receive, with sample order details filled in.
        </p>
      </div>

      {/* Which template */}
      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveKey(t.key)}
            className={`border px-3 py-2 text-left transition-colors rounded-md ${
              t.key === activeKey ? "border-foreground" : "border-border hover:border-muted-foreground"
            }`}
          >
            <span className="block font-body text-[11px] uppercase tracking-[0.1em]">{t.name}</span>
            <span className="block font-body text-[10px] text-muted-foreground mt-0.5 max-w-[220px]">
              {t.description}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 font-body text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={active.enabled}
            onChange={(e) => edit("enabled", e.target.checked)}
            className="accent-current"
          />
          Send this one automatically
        </label>
        {!active.enabled && (
          <Badge variant="secondary" className="text-[9px] uppercase tracking-[0.1em]">
            Paused
          </Badge>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-subject" className={label}>Email subject</Label>
        <Input
          id="tpl-subject"
          value={active.subject}
          onChange={(e) => edit("subject", e.target.value)}
          className="text-[12px]"
        />
      </div>

      {/* Body: edit and preview */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label htmlFor="tpl-html" className={label}>Email design</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "design" ? "secondary" : "ghost"}
              className="h-7 text-[10px]"
              onClick={() => setMode("design")}
            >
              <LayoutTemplate className="w-3 h-3 mr-1" /> Design
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "preview" ? "secondary" : "ghost"}
              className="h-7 text-[10px]"
              onClick={() => setMode("preview")}
            >
              <Eye className="w-3 h-3 mr-1" /> Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "code" ? "secondary" : "ghost"}
              className="h-7 text-[10px]"
              onClick={() => setMode("code")}
            >
              <Code className="w-3 h-3 mr-1" /> HTML
            </Button>
          </div>
        </div>

        {mode === "design" ? (
          active.design ? (
            <EmailDesigner
              design={active.design}
              onChange={editDesign}
              previewHtml={render(active.html)}
            />
          ) : (
            // This template's HTML was written by hand, so there's no block
            // layout to open. Switching to the designer replaces it, which is a
            // destructive-enough step to ask for first.
            <div className="border border-dashed border-border rounded-md p-6 text-center space-y-3">
              <p className="font-body text-[12px] text-muted-foreground leading-relaxed max-w-sm mx-auto">
                This email's HTML was written by hand. Building it with blocks will replace that
                markup with a fresh layout you can drag around.
              </p>
              <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]"
                onClick={startDesigning}>
                <LayoutTemplate className="w-3.5 h-3.5 mr-1" /> Build it with blocks
              </Button>
            </div>
          )
        ) : mode === "code" ? (
          <>
            <Textarea
              id="tpl-html"
              value={active.html}
              onChange={(e) => editHtml(e.target.value)}
              rows={20}
              spellCheck={false}
              className="font-mono text-[11px] leading-relaxed"
            />
            {active.design && (
              <p className="font-body text-[10px] text-muted-foreground">
                Editing here detaches the block layout — the designer will offer to rebuild it.
              </p>
            )}
          </>
        ) : (
          // Sandboxed: the preview runs the template's own markup, so it gets
          // no access to the dashboard around it.
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={render(active.html)}
            className="w-full h-[520px] border border-border rounded-md bg-white"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-sms" className={label}>Text message (leave empty to never text)</Label>
        <Textarea
          id="tpl-sms"
          value={active.sms_body ?? ""}
          onChange={(e) => edit("sms_body", e.target.value)}
          rows={3}
          className="text-[12px]"
        />
        <p className="font-body text-[10px] text-muted-foreground">
          Preview: {render(active.sms_body ?? "") || "—"}
        </p>
      </div>

      {/* What you can drop into either */}
      <div className="border border-border rounded-md p-3">
        <p className={label}>Placeholders</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <code
              key={p}
              className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
            >
              {`{{${p}}}`}
            </code>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-9 text-[11px] uppercase tracking-[0.1em]"
          disabled={!dirty || savingKey === active.key}
          onClick={save}
        >
          {savingKey === active.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save template"}
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" className="h-9 text-[11px]" onClick={revert}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Discard changes
          </Button>
        )}
      </div>
    </div>
  );
};

export default EmailTemplatesTab;
