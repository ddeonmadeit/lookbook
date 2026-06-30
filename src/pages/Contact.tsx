import { useState } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Contact = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !message.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setSending(true);
    try {
      const { error } = await supabase.from("contact_submissions").insert({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        message: message.trim(),
      });

      if (error) throw error;

      // Send email notification
      supabase.functions.invoke("send-contact-notification", {
        body: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          message: message.trim(),
        },
      }).catch((err) => console.error("Notification email failed:", err));

      toast.success("Message sent! We'll get back to you soon.");
      setName("");
      setEmail("");
      setPhone("");
      setMessage("");
    } catch (err) {
      console.error("Contact form error:", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar sticky={true} glassEffect={true} />

      <main className="pt-20 px-6 pb-32 max-w-2xl mx-auto">
        <h1 className="font-display text-3xl font-bold tracking-[0.2em] uppercase mb-4 text-left">
          Contact
        </h1>

        <div className="space-y-4 font-body text-sm leading-relaxed text-foreground mb-10">
          <p>Stay Connected</p>
          <a
            href="https://www.instagram.com/knots.raw"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-display text-xs font-bold tracking-[0.15em] uppercase underline underline-offset-4 hover:text-muted-foreground transition-colors"
          >
            Instagram
          </a>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 font-body text-sm">
          <div>
            <label htmlFor="name" className="block text-xs font-medium tracking-[0.15em] uppercase mb-2">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-transparent border-b border-foreground/30 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-medium tracking-[0.15em] uppercase mb-2">
              Email <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border-b border-foreground/30 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-xs font-medium tracking-[0.15em] uppercase mb-2">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-transparent border-b border-foreground/30 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
            />
          </div>

          <div>
            <label htmlFor="message" className="block text-xs font-medium tracking-[0.15em] uppercase mb-2">
              Comment <span className="text-muted-foreground">*</span>
            </label>
            <textarea
              id="message"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full bg-transparent border-b border-foreground/30 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="px-10 py-3 font-display text-xs font-bold tracking-[0.15em] uppercase bg-foreground text-background rounded-full hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </main>

      {/* Glassmorphism EXPLORE button - matching About page */}
      <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pb-[env(safe-area-inset-bottom)]">
        <Link
          to="/"
          className="px-12 py-4 font-display text-sm font-bold tracking-[0.1em] uppercase bg-background/30 backdrop-blur-xl border border-border/30 rounded-full text-foreground hover:bg-background/50 transition-all duration-300 shadow-lg"
        >
          Explore
        </Link>
      </div>
    </div>
  );
};

export default Contact;
