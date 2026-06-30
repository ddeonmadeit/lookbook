const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_NAME = "Knots";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, email, phone, message } = await req.json();

    if (!email || !message) {
      return new Response(
        JSON.stringify({ error: "Email and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const notificationEmail = Deno.env.get("NOTIFICATION_EMAIL");
    if (!notificationEmail) {
      throw new Error("NOTIFICATION_EMAIL not configured");
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const html = buildHtml(name, email, phone, message);
    const plainText = `New Contact Submission\n\nName: ${name || "Not provided"}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ""}Message: ${message}`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: `${SITE_NAME} <onboarding@resend.dev>`,
        to: [notificationEmail],
        subject: `Contact Form: ${name || email}`,
        html,
        text: plainText,
        reply_to: email,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Resend API error:", response.status, responseText);
      throw new Error(`Resend API returned ${response.status}: ${responseText}`);
    }

    console.log("Email sent successfully:", responseText);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error sending notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildHtml(name: string, email: string, phone: string | null, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: #ffffff; font-family: 'Arial', sans-serif; color: hsl(20, 12%, 18%); }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-family: 'Space Grotesk', Arial, sans-serif; font-size: 22px; letter-spacing: 0.15em; text-transform: uppercase; color: hsl(30, 10%, 10%); margin-bottom: 24px; }
    .field { margin-bottom: 16px; }
    .label { font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: hsl(20, 8%, 42%); margin-bottom: 4px; }
    .value { font-size: 14px; line-height: 1.6; color: hsl(20, 12%, 18%); }
    .message-box { background: hsl(27, 100%, 97%); border-left: 3px solid hsl(30, 10%, 10%); padding: 16px; margin-top: 24px; }
    .footer { margin-top: 32px; font-size: 11px; color: hsl(20, 8%, 42%); letter-spacing: 0.1em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>New Contact Submission</h1>
    <div class="field">
      <div class="label">Name</div>
      <div class="value">${escapeHtml(name || "Not provided")}</div>
    </div>
    <div class="field">
      <div class="label">Email</div>
      <div class="value">${escapeHtml(email)}</div>
    </div>
    ${phone ? `<div class="field"><div class="label">Phone</div><div class="value">${escapeHtml(phone)}</div></div>` : ""}
    <div class="message-box">
      <div class="label">Message</div>
      <div class="value">${escapeHtml(message).replace(/\n/g, "<br>")}</div>
    </div>
    <div class="footer">Sent from Knots contact form</div>
  </div>
</body>
</html>`;
}
