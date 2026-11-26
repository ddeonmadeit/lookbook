import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import KnotsMark from "@/components/KnotsMark";
import {
  type Availability,
  type NyeTicket,
  type QuoteLine,
  NYE_EVENT,
  NYE_MIDNIGHT,
  countdownParts,
  currentPrice,
  dollars,
  linesLabel,
  maxQuantity,
  pad2,
  saleState,
  saveTicket,
  savedTickets,
  tierLine,
  tiersOf,
} from "@/lib/nye";

import flyerLoop from "@/assets/nye/flyer.webp";
import flyerPoster from "@/assets/nye/flyer-poster.jpg";

/**
 * supabase.functions.invoke() reports any non-2xx as a generic error and
 * leaves `data` null; the reason worth showing is in the body.
 */
async function tickets<T>(body: Record<string, unknown>): Promise<{ data: (T & { error?: string }) | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke("nye-tickets", { body });
    if (!error) return { data: data as T, error: null };
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = await context.clone().json();
        return { data: parsed, error: parsed?.error ?? "Something went wrong — please try again." };
      } catch {
        /* not JSON */
      }
    }
    return { data: null, error: "Something went wrong — please try again." };
  } catch {
    return { data: null, error: "Connection problem — please try again." };
  }
}

const stripes = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!stripes.has(key)) {
    // A failed load isn't cached, so trying again really tries again.
    const loading = loadStripe(key).catch(() => null);
    loading.then((s) => s || stripes.delete(key));
    stripes.set(key, loading);
  }
  return stripes.get(key)!;
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A burst of confetti, once, when a ticket comes through. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        "--x": `${(Math.random() - 0.5) * 120}vw`,
        "--y": `${-30 - Math.random() * 70}vh`,
        "--r": `${(Math.random() - 0.5) * 1080}deg`,
        "--d": `${1.4 + Math.random() * 1.2}s`,
        "--delay": `${Math.random() * 0.15}s`,
        "--c": ["#efe8dc", "#c2452a", "#8f2a17", "#d6caba"][i % 4],
      })) as CSSProperties[],
    [],
  );
  if (reducedMotion()) return null;
  return (
    <div className="nye-confetti" aria-hidden>
      {pieces.map((style, i) => (
        <span key={i} style={style} />
      ))}
    </div>
  );
}

const FLYER_ALT = `KNOTS ${NYE_EVENT.title} — ${NYE_EVENT.venue}, ${NYE_EVENT.time}`;

/**
 * The flyer, looping forever: an animated image, exactly like a GIF. Unlike
 * video it never needs autoplay permission, never stops when the phone is in
 * Low Power Mode or the app goes to the background, and never shows a play
 * button.
 */
function FlyerLoop() {
  return (
    <img
      src={flyerLoop}
      alt={FLYER_ALT}
      className="nye-flyer-media"
      draggable={false}
      decoding="async"
      fetchPriority="high"
    />
  );
}

/** The flyer, with a gentle tilt under a mouse (transform only, so it never costs a repaint). */
function Flyer() {
  const ref = useRef<HTMLDivElement>(null);
  const tilt = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(x * 10).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
  };
  const reset = () => {
    ref.current?.style.removeProperty("--ry");
    ref.current?.style.removeProperty("--rx");
  };
  return (
    <div className="nye-flyer-stage">
      <div ref={ref} className="nye-flyer" onPointerMove={tilt} onPointerLeave={reset}>
        <FlyerLoop />
      </div>
    </div>
  );
}

/** Ticks on its own, so the rest of the page doesn't redraw every second. */
function Countdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const { days, hours, minutes, seconds } = countdownParts(NYE_MIDNIGHT - now);
  const cells: Array<[string, string]> = [
    [pad2(days), "Days"],
    [pad2(hours), "Hrs"],
    [pad2(minutes), "Min"],
    [pad2(seconds), "Sec"],
  ];
  return (
    <div className="nye-countdown" role="timer" aria-label={`${days} days, ${hours} hours, ${minutes} minutes until midnight`}>
      {cells.map(([value, label]) => (
        <div key={label} className="nye-countdown-cell">
          <span key={value} className="nye-countdown-num">
            {value}
          </span>
          <span className="nye-countdown-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function TicketStub({ ticket, fresh }: { ticket: NyeTicket; fresh: boolean }) {
  return (
    <div className={`nye-stub${fresh ? " is-fresh" : ""}`}>
      <div className="nye-stub-head">
        <span className="nye-stub-label">Your ticket</span>
        <span className="nye-stub-in">You're in</span>
      </div>
      <dl className="nye-stub-grid">
        <div>
          <dt>Name</dt>
          <dd>{ticket.name || "Ticket holder"}</dd>
        </div>
        <div>
          <dt>Admits</dt>
          <dd>{ticket.quantity}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{NYE_EVENT.date}</dd>
        </div>
        <div>
          <dt>Ref</dt>
          <dd className="nye-mono">{ticket.ref}</dd>
        </div>
      </dl>
      <p className="nye-stub-note">
        {ticket.releases ? `${ticket.releases}. ` : ""}Show this screen or give your name at the door.
      </p>
    </div>
  );
}

interface Session {
  clientSecret: string;
  publishableKey: string;
  sessionId: string;
  /** What the server actually held and is charging for. */
  lines: QuoteLine[];
  total: number;
}

/**
 * The unlisted NYE ticket page. Nothing links here; the only way out is the
 * KNOTS mark, back to the countdown.
 */
const Nye = () => {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [failed, setFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  // What's typed in the quantity box while it's being edited (it may be empty mid-edit).
  const [qtyText, setQtyText] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [owned, setOwned] = useState<NyeTicket[]>(() => savedTickets());
  const [freshRef, setFreshRef] = useState<string | null>(null);
  const [after, setAfter] = useState(() => Date.now() >= NYE_MIDNIGHT);
  const ticketRef = useRef<HTMLDivElement>(null);

  // Page identity: its own title, black browser chrome, never indexed — and
  // the page scrolls as the document itself, which is what makes it smooth
  // on phones (the rest of the site scrolls inside a fixed container).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `KNOTS — ${NYE_EVENT.title}`;
    const robots = Object.assign(document.createElement("meta"), { name: "robots", content: "noindex, nofollow" });
    document.head.appendChild(robots);
    const theme = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = theme?.content;
    if (theme) theme.content = "#000000";
    document.documentElement.classList.add("nye-doc");
    return () => {
      document.title = prevTitle;
      robots.remove();
      if (theme && prevTheme) theme.content = prevTheme;
      document.documentElement.classList.remove("nye-doc", "nye-locked");
    };
  }, []);

  // Midnight is weeks away, beyond what one timer can wait for: check twice a minute.
  useEffect(() => {
    if (after) return;
    const id = setInterval(() => Date.now() >= NYE_MIDNIGHT && setAfter(true), 30_000);
    return () => clearInterval(id);
  }, [after]);

  const refresh = useCallback(async () => {
    const { data, error } = await tickets<Availability>({ action: "availability" });
    if (error || !data || typeof data.price !== "number") {
      setFailed(true);
      return;
    }
    setFailed(false);
    setAvailability(data);
  }, []);

  // What's on sale, kept fresh while the page is open and on screen.
  useEffect(() => {
    refresh();
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), 30_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const limit = maxQuantity(availability);
  useEffect(() => {
    if (limit > 0 && quantity > limit) setQuantity(limit);
  }, [limit, quantity]);

  const confirm = useCallback(
    async (sessionId: string) => {
      setConfirming(true);
      setMessage(null);
      try {
        // The payment can land a moment after Stripe hands back, so ask a few times.
        for (let attempt = 0; attempt < 6; attempt++) {
          const { data } = await tickets<{ status: string; ticket: NyeTicket | null }>({
            action: "confirm",
            session_id: sessionId,
          });
          if (data?.status === "paid" && data.ticket) {
            setOwned(saveTicket(data.ticket));
            setFreshRef(data.ticket.ref);
            setTimeout(() => ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
            refresh();
            return;
          }
          if (data?.status === "expired") break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        setMessage("We couldn't confirm that payment yet. If you were charged, your ticket is safe — reload this page in a minute.");
      } finally {
        setConfirming(false);
      }
    },
    [refresh],
  );

  // Back from a payment that needed a redirect (some banks do).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    window.history.replaceState(null, "", window.location.pathname);
    confirm(sessionId);
  }, [confirm]);

  const state = saleState(availability, failed, after ? NYE_MIDNIGHT : Date.now());
  const tiers = tiersOf(availability);
  const price = currentPrice(tiers);
  const total = price * quantity;

  const start = async () => {
    if (state !== "on-sale" || starting) return;
    setStarting(true);
    setMessage(null);
    const { data, error } = await tickets<{
      client_secret: string;
      publishable_key: string;
      session_id: string;
      lines: QuoteLine[];
      total: number;
    }>({
      action: "checkout",
      quantity,
      return_url: `${window.location.origin}/nye/`,
    });
    setStarting(false);
    if (error || !data?.client_secret) {
      setMessage(error ?? "Something went wrong — please try again.");
      refresh();
      return;
    }
    setSession({
      clientSecret: data.client_secret,
      publishableKey: data.publishable_key,
      sessionId: data.session_id,
      lines: data.lines ?? [{ tier: "entry", name: "Entry", price, quantity }],
      total: data.total ?? total,
    });
  };

  const closeSheet = useCallback(() => {
    setSession((s) => {
      // Give the places back now rather than when the payment form times out.
      if (s) tickets({ action: "release", session_id: s.sessionId }).then(() => refresh());
      return null;
    });
  }, [refresh]);

  // The page behind the payment sheet stays put.
  useEffect(() => {
    document.documentElement.classList.toggle("nye-locked", Boolean(session));
  }, [session]);

  // If the payment form can't load (a dropped connection, a blocker), say so
  // rather than leave an empty sheet, and give the places back.
  useEffect(() => {
    if (!session) return;
    let current = true;
    stripeFor(session.publishableKey).then((stripe) => {
      if (stripe || !current) return;
      closeSheet();
      setMessage("The payment form couldn't load — check your connection and try again.");
    });
    return () => {
      current = false;
    };
  }, [session, closeSheet]);

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSheet();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, closeSheet]);

  const onComplete = useCallback(() => {
    setSession((s) => {
      if (s) confirm(s.sessionId);
      return null;
    });
  }, [confirm]);

  const checkoutOptions = useMemo(
    () => (session ? { clientSecret: session.clientSecret, onComplete } : null),
    [session, onComplete],
  );

  const buyLabel =
    state === "sold-out"
      ? "Sold out"
      : state === "closed"
        ? "Sales closed"
        : state === "unavailable"
          ? "On sale soon"
          : confirming
            ? "Confirming…"
            : starting
              ? "Opening…"
              : `${owned.length ? "Buy more" : "Get tickets"} · ${dollars(total)}`;
  const canBuy = state === "on-sale" && !starting && !confirming;

  const controls = (
    <div className="nye-buy">
      {state === "on-sale" && (
        <div className="nye-stepper" role="group" aria-label="Number of tickets">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="One fewer ticket"
          >
            −
          </button>
          <input
            className="nye-qty"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Number of tickets"
            value={qtyText ?? String(quantity)}
            onFocus={(e) => {
              setQtyText(String(quantity));
              e.currentTarget.select();
            }}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
              setQtyText(digits);
              const n = Number(digits);
              if (n >= 1) setQuantity(Math.min(limit, n));
            }}
            onBlur={() => setQtyText(null)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(limit, q + 1))}
            disabled={quantity >= limit}
            aria-label="One more ticket"
          >
            +
          </button>
        </div>
      )}
      <button type="button" className="nye-cta" onClick={start} disabled={!canBuy}>
        <span>{buyLabel}</span>
      </button>
    </div>
  );

  return (
    <div className="nye">
      <style>{STYLE}</style>
      <div className="nye-glow" aria-hidden />

      <header className="nye-header">
        <Link to="/" className="nye-home" aria-label="KNOTS — back to the countdown">
          <KnotsMark className="nye-home-mark" />
        </Link>
        <span className="nye-header-meta">
          {NYE_EVENT.date} · {NYE_EVENT.time}
        </span>
      </header>

      <main className="nye-main">
        <section className="nye-col-flyer nye-rise" style={{ "--i": 0 } as CSSProperties}>
          <Flyer />
        </section>

        <section className="nye-col-info">
          <h1 className="nye-title nye-rise" style={{ "--i": 1 } as CSSProperties}>
            {after ? "Happy New Year" : NYE_EVENT.title}
          </h1>
          <p className="nye-sub nye-rise" style={{ "--i": 2 } as CSSProperties}>
            <span>{NYE_EVENT.venue}</span>
            <span>
              {NYE_EVENT.dateLong} · {NYE_EVENT.time}
            </span>
          </p>

          {!after && (
            <div className="nye-rise" style={{ "--i": 3 } as CSSProperties}>
              <Countdown />
            </div>
          )}

          {owned.length > 0 && (
            <div ref={ticketRef} className="nye-stubs">
              {owned.map((t) => (
                <TicketStub key={t.ref} ticket={t} fresh={t.ref === freshRef} />
              ))}
            </div>
          )}

          <div className="nye-panel nye-rise" style={{ "--i": 4 } as CSSProperties}>
            <p className="nye-panel-name">Tickets</p>
            <ul className="nye-tiers">
              {tiers.map((t, i) => {
                const waiting = state === "unavailable";
                const line = state === "closed" ? "Sales closed" : waiting ? "" : tierLine(t, tiers[i - 1]);
                return (
                  <li key={t.id} className={`nye-tier is-${waiting ? "next" : t.status}`}>
                    <div>
                      <p className="nye-tier-name">{t.name}</p>
                      {line && <p className="nye-tier-line">{line}</p>}
                    </div>
                    <p className="nye-tier-price">{dollars(t.price)}</p>
                  </li>
                );
              })}
            </ul>
            <div className="nye-panel-buy">{controls}</div>
            {message && (
              <p className="nye-message" role="alert">
                {message}
              </p>
            )}
            <p className="nye-fine">
              Prices go up release by release — you'll see your exact total before you pay. Apple Pay, Google Pay or
              card, without leaving this page; your ticket appears here straight away.
            </p>
          </div>
        </section>
      </main>

      <div className="nye-dock">{controls}</div>

      {freshRef && <Confetti key={freshRef} />}

      {session && checkoutOptions && (
        <div className="nye-sheet-wrap" role="dialog" aria-modal="true" aria-label="Pay for your tickets">
          <button type="button" className="nye-sheet-backdrop" aria-label="Close" onClick={closeSheet} />
          <div className="nye-sheet">
            <div className="nye-sheet-head">
              <div>
                <p className="nye-sheet-title">{linesLabel(session.lines)}</p>
                <p className="nye-sheet-sub">
                  {session.lines.length > 1
                    ? `${session.lines.map((l) => `${l.quantity} × ${dollars(l.price)}`).join(" + ")} = `
                    : ""}
                  {dollars(session.total)} AUD · places held for 30 minutes
                </p>
              </div>
              <button type="button" className="nye-sheet-close" onClick={closeSheet} aria-label="Close">
                ×
              </button>
            </div>
            <div className="nye-sheet-body">
              <EmbeddedCheckoutProvider stripe={stripeFor(session.publishableKey)} options={checkoutOptions}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const STYLE = `
  /* The page scrolls as the document: smoother on phones than a scrolling box. */
  html.nye-doc {
    height: auto; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: auto;
    padding: 0; background: #000;
  }
  html.nye-doc body { height: auto; min-height: 100%; overflow: visible; background: #000; }
  html.nye-doc #root { height: auto; }
  html.nye-doc.nye-locked, html.nye-doc.nye-locked body { overflow: hidden; }

  .nye, .nye *, .nye *::before, .nye *::after { box-sizing: border-box; }
  .nye {
    /* Every bit of text is bone or light taupe — never grey. */
    --bone: #efe8dc;
    --taupe: #d6caba;
    --line: rgba(239, 232, 220, 0.14);
    --red: 184, 58, 34;
    position: relative; min-height: 100vh; min-height: 100dvh;
    background: #000; color: var(--bone);
    font-family: var(--font-body);
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);
    -webkit-font-smoothing: antialiased;
  }
  .nye h1 { font-family: var(--font-display); }

  /* One faint, still glow: no animation, nothing to repaint while scrolling. */
  .nye-glow {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background: radial-gradient(70% 45% at 50% 105%, rgba(var(--red), 0.10), transparent 70%);
  }

  .nye-header, .nye-main { position: relative; z-index: 1; }
  .nye-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px 6px; max-width: 1180px; margin: 0 auto;
  }
  .nye-home { color: var(--bone); display: inline-flex; padding: 6px; margin: -6px; border-radius: 8px; transition: opacity .2s; }
  .nye-home:hover { opacity: 0.75; }
  .nye-home:focus-visible { outline: 1px solid var(--bone); outline-offset: 2px; }
  .nye-home-mark { width: 34px; height: auto; }
  .nye-header-meta { font-size: 11px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--taupe); }

  .nye-main {
    max-width: 1180px; margin: 0 auto; padding: 12px 20px 36px;
    display: grid; gap: 18px;
  }
  @media (min-width: 900px) {
    .nye-main {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 32px; align-items: center;
      padding-top: 24px; min-height: calc(100dvh - 90px);
    }
    /* Hug the title column. */
    .nye-main .nye-flyer-stage { justify-content: flex-end; }
    .nye-main .nye-title { font-size: clamp(56px, 5.2vw, 76px); }
  }

  .nye-rise { opacity: 0; transform: translateY(14px); animation: nyeRise .8s cubic-bezier(.2,.7,.2,1) forwards; animation-delay: calc(var(--i, 0) * 80ms + 60ms); }
  @keyframes nyeRise { to { opacity: 1; transform: none; } }

  /* Flyer */
  .nye-flyer-stage { perspective: 1200px; display: flex; justify-content: center; }
  .nye-flyer {
    --rx: 0deg; --ry: 0deg;
    position: relative; width: min(100%, 520px); aspect-ratio: 3 / 4;
    background: #120604 url('${flyerPoster}') center / cover no-repeat; border-radius: 6px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(239,232,220,0.06), 0 30px 60px -28px rgba(0,0,0,0.95);
    transform: rotateX(var(--rx)) rotateY(var(--ry));
    transition: transform .6s cubic-bezier(.2,.7,.2,1);
    -webkit-touch-callout: none; user-select: none;
  }
  @media (hover: hover) { .nye-flyer:hover { transition-duration: .12s; } }
  .nye-flyer-media {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;
    pointer-events: none; background: transparent;
  }

  /* Info */
  .nye-title {
    font-weight: 700; margin: 0; text-transform: uppercase; color: var(--bone);
    font-size: clamp(42px, 12.5vw, 88px); line-height: 0.9; letter-spacing: -0.025em;
  }
  .nye-sub { margin: 14px 0 0; display: grid; gap: 4px; font-size: 13px; line-height: 1.5; color: var(--taupe); }
  .nye-sub span:first-child { color: var(--bone); }

  .nye-countdown { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 22px; max-width: 460px; }
  .nye-countdown-cell {
    border: 1px solid var(--line); border-radius: 8px; padding: 12px 6px 9px; text-align: center;
    background: rgba(239,232,220,0.03); overflow: hidden; display: flex; flex-direction: column; gap: 4px;
  }
  .nye-countdown-num {
    display: block; font-family: var(--font-display); font-weight: 700; font-size: clamp(28px, 8vw, 40px); line-height: 1;
    font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--bone);
    animation: nyeTick .4s cubic-bezier(.2,.7,.2,1);
  }
  @keyframes nyeTick { from { transform: translateY(-35%); opacity: 0; } to { transform: none; opacity: 1; } }
  .nye-countdown-label { font-size: 9px; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--taupe); }

  .nye-panel {
    margin-top: 22px; max-width: 460px; border: 1px solid var(--line); border-radius: 12px; padding: 18px;
    background: #0b0908;
  }
  .nye-panel-name { margin: 0; font-weight: 600; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--bone); }

  .nye-tiers { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
  .nye-tier {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px;
    transition: border-color .3s, background-color .3s, opacity .3s;
  }
  .nye-tier.is-on-sale { border-color: rgba(var(--red), 0.85); background: rgba(var(--red), 0.08); }
  .nye-tier.is-next { opacity: 0.6; }
  .nye-tier.is-sold-out { opacity: 0.5; }
  .nye-tier.is-sold-out .nye-tier-name, .nye-tier.is-sold-out .nye-tier-price { text-decoration: line-through; text-decoration-thickness: 1px; }
  .nye-tier.is-sold-out .nye-tier-line { text-transform: uppercase; letter-spacing: 0.16em; font-size: 11px; font-weight: 600; color: var(--bone); }
  .nye-tier-name { margin: 0; font-weight: 600; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--bone); }
  .nye-tier-line { margin: 3px 0 0; font-size: 12px; color: var(--taupe); }
  .nye-tier-price { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 24px; line-height: 1; letter-spacing: -0.01em; color: var(--bone); }

  .nye-panel-buy { margin-top: 16px; }
  .nye-message { margin: 12px 0 0; font-size: 12px; line-height: 1.5; color: var(--bone); }
  .nye-fine { margin: 14px 0 0; font-size: 11px; line-height: 1.6; color: var(--taupe); }

  .nye-buy { display: flex; gap: 10px; align-items: stretch; }
  .nye-stepper { display: flex; align-items: center; border: 1px solid rgba(239,232,220,0.24); border-radius: 999px; flex-shrink: 0; }
  .nye-stepper button {
    width: 44px; height: 52px; background: none; border: 0; color: var(--bone); font-size: 20px; cursor: pointer;
    font-family: inherit; touch-action: manipulation;
  }
  .nye-stepper button:disabled { opacity: 0.3; cursor: default; }
  .nye-qty {
    width: 3.2ch; min-width: 26px; padding: 0; border: 0; background: transparent; text-align: center;
    font-family: inherit; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums; color: var(--bone);
    -moz-appearance: textfield; appearance: textfield; outline: none; caret-color: var(--bone);
  }
  .nye-qty:focus { border-bottom: 1px solid rgba(239,232,220,0.5); }
  .nye-cta {
    position: relative; overflow: hidden; flex: 1; height: 54px; border-radius: 999px; border: 0;
    background: rgb(var(--red)); color: var(--bone); cursor: pointer; touch-action: manipulation;
    font-family: var(--font-body); font-weight: 600; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase;
    transition: transform .15s, background-color .3s;
  }
  .nye-cta::after {
    content: ""; position: absolute; inset: 0; width: 40%;
    background: linear-gradient(100deg, transparent, rgba(239,232,220,0.16), transparent);
    transform: translateX(-120%); animation: nyeShine 3.6s ease-in-out infinite;
  }
  @keyframes nyeShine { 0% { transform: translateX(-120%); } 55%, 100% { transform: translateX(320%); } }
  .nye-cta:active:not(:disabled) { transform: scale(0.97); }
  .nye-cta:focus-visible { outline: 2px solid var(--bone); outline-offset: 3px; }
  .nye-cta:disabled { background: transparent; color: var(--taupe); border: 1px solid var(--line); cursor: default; }
  .nye-cta:disabled::after { display: none; }
  .nye-cta span { position: relative; z-index: 1; }

  /* Ticket stub */
  .nye-stubs { display: grid; gap: 12px; margin-top: 22px; max-width: 460px; }
  .nye-stub {
    position: relative; border-radius: 12px; padding: 18px 18px 16px; color: var(--bone);
    background: #15100d; border: 1px solid rgba(239,232,220,0.2);
    -webkit-mask: radial-gradient(circle at 0 62%, transparent 11px, #000 11.5px) left / 51% 100% no-repeat,
                  radial-gradient(circle at 100% 62%, transparent 11px, #000 11.5px) right / 51% 100% no-repeat;
            mask: radial-gradient(circle at 0 62%, transparent 11px, #000 11.5px) left / 51% 100% no-repeat,
                  radial-gradient(circle at 100% 62%, transparent 11px, #000 11.5px) right / 51% 100% no-repeat;
  }
  .nye-stub.is-fresh { animation: nyeStubIn .9s cubic-bezier(.2,.9,.25,1.2); }
  @keyframes nyeStubIn { from { transform: translateY(30px) rotate(-3deg) scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
  .nye-stub-head { display: flex; justify-content: space-between; align-items: baseline; }
  .nye-stub-label { font-size: 11px; font-weight: 500; letter-spacing: 0.24em; text-transform: uppercase; color: var(--taupe); }
  .nye-stub-in { font-family: var(--font-display); font-weight: 700; font-size: 22px; line-height: 1; text-transform: uppercase; letter-spacing: -0.01em; color: var(--bone); }
  .nye-stub-grid {
    display: grid; grid-template-columns: 1fr auto; gap: 10px 16px; margin: 16px 0 0; padding-top: 14px;
    border-top: 1px dashed rgba(239,232,220,0.28);
  }
  .nye-stub-grid div:nth-child(even) { text-align: right; }
  .nye-stub-grid dt { font-size: 9px; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--taupe); }
  .nye-stub-grid dd { margin: 2px 0 0; font-family: var(--font-display); font-weight: 700; font-size: 15px; overflow-wrap: anywhere; color: var(--bone); }
  .nye-mono { font-family: ui-monospace, Menlo, Consolas, monospace !important; letter-spacing: 0.04em; }
  .nye-stub-note { margin: 14px 0 0; font-size: 11px; line-height: 1.5; color: var(--taupe); }

  /* Phones: the buy button stays under the thumb */
  .nye-dock {
    position: sticky; bottom: 0; z-index: 4; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.88) 32%, #000);
  }
  @media (max-width: 899px) { .nye-panel-buy { display: none; } }
  @media (min-width: 900px) { .nye-dock { display: none; } }

  /* Confetti */
  .nye-confetti { position: fixed; left: 50%; top: 60%; z-index: 60; pointer-events: none; }
  .nye-confetti span {
    position: absolute; width: 7px; height: 12px; background: var(--c); border-radius: 1px; opacity: 0;
    animation: nyeConfetti var(--d) cubic-bezier(.15,.6,.3,1) var(--delay) forwards;
  }
  @keyframes nyeConfetti {
    0% { transform: translate(0,0) rotate(0); opacity: 1; }
    70% { opacity: 1; }
    100% { transform: translate(var(--x), calc(var(--y) + 70vh)) rotate(var(--r)); opacity: 0; }
  }

  /* Payment sheet */
  .nye-sheet-wrap { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; }
  .nye-sheet-backdrop {
    position: absolute; inset: 0; border: 0; padding: 0; background: rgba(0,0,0,0.8); animation: nyeFade .25s ease;
  }
  .nye-sheet {
    position: relative; width: 100%; max-width: 560px; max-height: 94dvh; display: flex; flex-direction: column;
    background: #0d0a08; color: var(--bone); border: 1px solid var(--line); border-bottom: 0;
    border-radius: 18px 18px 0 0; overflow: hidden;
    animation: nyeUp .38s cubic-bezier(.2,.8,.2,1);
  }
  @media (min-width: 640px) {
    .nye-sheet-wrap { align-items: center; padding: 24px; }
    .nye-sheet { border-radius: 16px; border-bottom: 1px solid var(--line); max-height: 90dvh; }
  }
  .nye-sheet-head {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 16px 18px; border-bottom: 1px solid var(--line);
  }
  .nye-sheet-title { margin: 0; font-weight: 600; font-size: 12px; line-height: 1.5; letter-spacing: 0.12em; text-transform: uppercase; color: var(--bone); }
  .nye-sheet-sub { margin: 3px 0 0; font-size: 12px; color: var(--taupe); }
  .nye-sheet-close {
    width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--bone);
    font-size: 24px; line-height: 1; cursor: pointer; flex-shrink: 0;
  }
  .nye-sheet-body {
    overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
    padding: 10px 10px calc(14px + env(safe-area-inset-bottom, 0px)); min-height: 360px;
  }
  @keyframes nyeUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes nyeFade { from { opacity: 0; } to { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .nye *:not(.nye-flyer-media), .nye *::before, .nye *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    .nye-rise { opacity: 1; transform: none; }
  }
`;

export default Nye;
