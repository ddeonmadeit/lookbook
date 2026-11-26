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

import flyerVideo from "@/assets/nye/flyer.mp4";
import flyerFallback from "@/assets/nye/flyer-fallback.webp";
import flyerPoster from "@/assets/nye/flyer-poster.jpg";

/**
 * supabase.functions.invoke() reports any non-2xx as a generic error and
 * leaves `data` null; the reason worth showing ("Only 3 left") is in the body.
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

/** Warm embers drifting up behind everything. */
function Embers() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || reducedMotion()) return;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const spawn = (anywhere: boolean) => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      r: 0.5 + Math.random() * 1.7,
      vy: 0.12 + Math.random() * 0.5,
      vx: (Math.random() - 0.5) * 0.18,
      a: 0.15 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
    });
    const embers = Array.from({ length: w < 640 ? 30 : 56 }, () => spawn(true));
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const step = Math.min(50, t - last) / 16.67;
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const e of embers) {
        e.y -= e.vy * step;
        e.x += (e.vx + Math.sin(t / 1300 + e.phase) * 0.12) * step;
        if (e.y < -10) Object.assign(e, spawn(false));
        const flicker = 0.55 + 0.45 * Math.sin(t / 380 + e.phase);
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 150, 100, ${(e.a * flicker).toFixed(3)})`;
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="nye-embers" aria-hidden />;
}

/** A burst of confetti, once, when a ticket comes through. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        "--x": `${(Math.random() - 0.5) * 120}vw`,
        "--y": `${-30 - Math.random() * 70}vh`,
        "--r": `${(Math.random() - 0.5) * 1080}deg`,
        "--d": `${1.4 + Math.random() * 1.2}s`,
        "--delay": `${Math.random() * 0.15}s`,
        "--c": ["#fff", "#ff7a45", "#e8321e", "#ffc9a8"][i % 4],
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

const FLYER_ALT = `KNOTS ${NYE_EVENT.title} — ${NYE_EVENT.kind}, ${NYE_EVENT.venue}, ${NYE_EVENT.time}`;

/**
 * The flyer, looping like a GIF: a muted inline video with no controls, and
 * no way to tap into it. Where a phone won't autoplay video (iPhone Low Power
 * Mode, data savers) or can't play it, an animated image takes its place, so
 * there's never a play button.
 */
function FlyerLoop() {
  const ref = useRef<HTMLVideoElement>(null);
  const [asImage, setAsImage] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.defaultMuted = true;
    video.muted = true;
    video.setAttribute("muted", "");
    video.setAttribute("disablepictureinpicture", "");
    video.setAttribute("disableremoteplayback", "");
    video.play()?.catch((err: DOMException) => {
      if (err?.name !== "AbortError") setAsImage(true);
    });
  }, []);
  if (asImage) return <img src={flyerFallback} alt={FLYER_ALT} className="nye-flyer-media" draggable={false} />;
  return (
    <video
      ref={ref}
      className="nye-flyer-media"
      src={flyerVideo}
      poster={flyerPoster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      controls={false}
      tabIndex={-1}
      aria-label={FLYER_ALT}
      onError={() => setAsImage(true)}
    />
  );
}

function Flyer() {
  const ref = useRef<HTMLDivElement>(null);
  const tilt = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * 14).toFixed(2)}deg`);
    el.style.setProperty("--sx", `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--sy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty("--ry");
    el.style.removeProperty("--rx");
  };
  return (
    <div className="nye-flyer-stage">
      <div ref={ref} className="nye-flyer" onPointerMove={tilt} onPointerLeave={reset}>
        <FlyerLoop />
        <div className="nye-flyer-sheen" aria-hidden />
      </div>
    </div>
  );
}

function Countdown({ now }: { now: number }) {
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
        <span className="nye-eyebrow">Your ticket</span>
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
  const [now, setNow] = useState(() => Date.now());
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [failed, setFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [owned, setOwned] = useState<NyeTicket[]>(() => savedTickets());
  const [freshRef, setFreshRef] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  // Page identity: its own title, black browser chrome, and never indexed.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `KNOTS — ${NYE_EVENT.title}`;
    const robots = Object.assign(document.createElement("meta"), { name: "robots", content: "noindex, nofollow" });
    document.head.appendChild(robots);
    const theme = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = theme?.content;
    if (theme) theme.content = "#000000";
    return () => {
      document.title = prevTitle;
      robots.remove();
      if (theme && prevTheme) theme.content = prevTheme;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const { data, error } = await tickets<Availability>({ action: "availability" });
    if (error || !data || typeof data.price !== "number") {
      setFailed(true);
      return;
    }
    setFailed(false);
    setAvailability(data);
  }, []);

  // What's left, kept fresh while the page is open and on screen.
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

  // The glow follows the pointer.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion()) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty("--gx", `${e.clientX}px`);
        root.style.setProperty("--gy", `${e.clientY}px`);
        root.classList.add("has-pointer");
      });
    };
    window.addEventListener("pointermove", move);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  const state = saleState(availability, failed, now);
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
          <output aria-live="polite">{quantity}</output>
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

  const after = now >= NYE_MIDNIGHT;

  return (
    <div ref={rootRef} className="nye">
      <style>{STYLE}</style>
      <Embers />
      <div className="nye-glow" aria-hidden />
      <div className="nye-grain" aria-hidden />

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
          <p className="nye-eyebrow nye-rise" style={{ "--i": 1 } as CSSProperties}>
            KNOTS presents
          </p>
          <h1 className="nye-title nye-rise" style={{ "--i": 2 } as CSSProperties}>
            {after ? "Happy New Year" : NYE_EVENT.title}
          </h1>
          <p className="nye-sub nye-rise" style={{ "--i": 3 } as CSSProperties}>
            <span>
              {NYE_EVENT.kind} · {NYE_EVENT.venue}
            </span>
            <span>
              {NYE_EVENT.dateLong} · {NYE_EVENT.time}
            </span>
          </p>

          {!after && (
            <div className="nye-rise" style={{ "--i": 4 } as CSSProperties}>
              <Countdown now={now} />
            </div>
          )}

          {owned.length > 0 && (
            <div ref={ticketRef} className="nye-stubs">
              {owned.map((t) => (
                <TicketStub key={t.ref} ticket={t} fresh={t.ref === freshRef} />
              ))}
            </div>
          )}

          <div className="nye-panel nye-rise" style={{ "--i": 5 } as CSSProperties}>
            <div className="nye-panel-head">
              <p className="nye-panel-name">Tickets</p>
            </div>
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
              Prices go up release by release — you'll see your exact total before you pay. Card, Apple Pay or Google
              Pay, without leaving this page; your ticket appears here straight away.
            </p>
          </div>
        </section>
      </main>

      <div className="nye-marquee" aria-hidden>
        <div className="nye-marquee-track">
          {Array.from({ length: 2 }, (_, k) => (
            <span key={k}>
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i}>
                  New Year's Eve <i>✦</i> {NYE_EVENT.kind} <i>✦</i> {NYE_EVENT.date} <i>✦</i> {NYE_EVENT.suburb} <i>✦</i>{" "}
                  {NYE_EVENT.time} <i>✦</i> KNOTS <i>✦</i>{" "}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

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
  .nye, .nye *, .nye *::before, .nye *::after { box-sizing: border-box; }
  .nye {
    --ink: #fff;
    --muted: rgba(255,255,255,0.56);
    --line: rgba(255,255,255,0.14);
    --warm: 255, 112, 64;
    --gx: 50vw; --gy: 30vh;
    position: fixed; inset: 0; overflow-y: auto; overflow-x: hidden;
    -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
    background: #000; color: var(--ink);
    font-family: var(--font-body);
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);
  }
  .nye h1, .nye h2, .nye h3 { font-family: var(--font-display); }

  .nye-embers, .nye-glow, .nye-grain { position: fixed; inset: 0; pointer-events: none; }
  .nye-embers { width: 100%; height: 100%; z-index: 0; }
  .nye-glow {
    z-index: 0; inset: -10%;
    background:
      radial-gradient(600px circle at var(--gx) var(--gy), rgba(var(--warm),0.12), transparent 60%),
      radial-gradient(900px circle at 50% 115%, rgba(var(--warm),0.12), transparent 60%);
    animation: nyeDrift 18s ease-in-out infinite alternate;
  }
  .nye.has-pointer .nye-glow { animation: none; }
  @keyframes nyeDrift {
    0% { transform: translate3d(-6vw, -4vh, 0); }
    100% { transform: translate3d(6vw, 4vh, 0); }
  }
  .nye-grain {
    z-index: 3; opacity: 0.09; mix-blend-mode: overlay;
    inset: -50%;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    animation: nyeGrain 0.9s steps(4) infinite;
  }
  @keyframes nyeGrain {
    0% { transform: translate(0,0); } 25% { transform: translate(-4%,3%); }
    50% { transform: translate(3%,-5%); } 75% { transform: translate(-2%,-2%); } 100% { transform: translate(0,0); }
  }

  .nye-header, .nye-main, .nye-marquee { position: relative; z-index: 2; }
  .nye-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px 6px; max-width: 1180px; margin: 0 auto;
  }
  .nye-home { color: #fff; display: inline-flex; padding: 6px; margin: -6px; border-radius: 8px; transition: opacity .2s; }
  .nye-home:hover { opacity: 0.7; }
  .nye-home:focus-visible { outline: 1px solid #fff; outline-offset: 2px; }
  .nye-home-mark { width: 34px; height: auto; }
  .nye-header-meta { font-size: 11px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); }

  .nye-main {
    max-width: 1180px; margin: 0 auto; padding: 14px 20px 40px;
    display: grid; gap: 30px;
  }
  @media (min-width: 900px) {
    .nye-main { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 64px; align-items: center; padding-top: 28px; min-height: calc(100dvh - 140px); }
  }

  .nye-rise { opacity: 0; transform: translateY(18px); animation: nyeRise .9s cubic-bezier(.2,.7,.2,1) forwards; animation-delay: calc(var(--i, 0) * 90ms + 80ms); }
  @keyframes nyeRise { to { opacity: 1; transform: none; } }

  /* Flyer */
  .nye-flyer-stage { perspective: 1200px; display: flex; justify-content: center; }
  .nye-flyer {
    --rx: 0deg; --ry: 0deg; --sx: 30%; --sy: 20%;
    position: relative; width: min(100%, 520px); aspect-ratio: 3 / 4;
    background: #120604 url('${flyerPoster}') center / cover no-repeat; border-radius: 6px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 40px 90px -30px rgba(var(--warm),0.45), 0 30px 60px -20px rgba(0,0,0,0.9);
    transform: rotateX(var(--rx)) rotateY(var(--ry));
    transform-style: preserve-3d;
    transition: transform .5s cubic-bezier(.2,.7,.2,1);
    animation: nyeFloat 7s ease-in-out infinite;
    -webkit-touch-callout: none; user-select: none;
  }
  @media (hover: hover) { .nye-flyer:hover { animation-play-state: paused; transition: transform .08s linear; } }
  @keyframes nyeFloat {
    0%, 100% { translate: 0 0; rotate: 0deg; }
    50% { translate: 0 -8px; rotate: -0.6deg; }
  }
  .nye-flyer-media {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block;
    pointer-events: none; background: transparent;
  }
  /* Never any player chrome, even where autoplay is refused. */
  .nye-flyer-media::-webkit-media-controls,
  .nye-flyer-media::-webkit-media-controls-panel,
  .nye-flyer-media::-webkit-media-controls-overlay-play-button,
  .nye-flyer-media::-webkit-media-controls-start-playback-button,
  .nye-flyer-media::-webkit-media-controls-enclosure { display: none !important; -webkit-appearance: none; opacity: 0; }
  .nye-flyer-sheen {
    position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light;
    background: radial-gradient(circle at var(--sx) var(--sy), rgba(255,255,255,0.16), transparent 45%),
      linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.10) 45%, transparent 60%);
    background-size: 100% 100%, 250% 100%;
    animation: nyeSheen 6s ease-in-out infinite;
  }
  @keyframes nyeSheen { 0% { background-position: 0 0, 120% 0; } 60%, 100% { background-position: 0 0, -120% 0; } }

  /* Info */
  .nye-eyebrow { font-size: 11px; font-weight: 500; letter-spacing: 0.24em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; }
  .nye-title {
    font-family: var(--font-display); font-weight: 600; margin: 0; text-transform: uppercase;
    font-size: clamp(40px, 11vw, 80px); line-height: 0.95; letter-spacing: -0.01em;
  }
  .nye-sub { margin: 16px 0 0; display: grid; gap: 4px; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .nye-sub span:first-child { color: rgba(255,255,255,0.86); }

  .nye-countdown { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 26px; max-width: 460px; }
  .nye-countdown-cell {
    border: 1px solid var(--line); border-radius: 8px; padding: 12px 6px 9px; text-align: center;
    background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
    overflow: hidden; display: flex; flex-direction: column; gap: 4px;
  }
  .nye-countdown-num {
    display: block; font-family: var(--font-display); font-weight: 600; font-size: clamp(28px, 8vw, 40px); line-height: 1;
    font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
    animation: nyeTick .45s cubic-bezier(.2,.7,.2,1);
  }
  @keyframes nyeTick { from { transform: translateY(-40%); opacity: 0; filter: blur(3px); } to { transform: none; opacity: 1; filter: none; } }
  .nye-countdown-label { font-size: 9px; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }

  .nye-panel {
    margin-top: 26px; max-width: 460px; border: 1px solid var(--line); border-radius: 12px; padding: 18px;
    background: rgba(10,10,10,0.72); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  }
  .nye-panel-head { display: flex; justify-content: space-between; align-items: baseline; }
  .nye-panel-name { margin: 0; font-weight: 600; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }

  .nye-tiers { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
  .nye-tier {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px;
    transition: border-color .3s, background .3s, opacity .3s;
  }
  .nye-tier.is-on-sale {
    border-color: rgba(var(--warm),0.75);
    background: linear-gradient(135deg, rgba(var(--warm),0.14), rgba(var(--warm),0.03));
    box-shadow: 0 0 30px -12px rgba(var(--warm),0.7);
  }
  .nye-tier.is-next { opacity: 0.55; }
  .nye-tier.is-sold-out { opacity: 0.45; }
  .nye-tier.is-sold-out .nye-tier-line { text-transform: uppercase; letter-spacing: 0.16em; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.75); }
  .nye-tier.is-sold-out .nye-tier-name, .nye-tier.is-sold-out .nye-tier-price { text-decoration: line-through; text-decoration-thickness: 1px; }
  .nye-tier-name { margin: 0; font-weight: 600; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
  .nye-tier-line { margin: 3px 0 0; font-size: 12px; color: var(--muted); }
  .nye-tier-price { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 24px; line-height: 1; letter-spacing: -0.01em; }

  .nye-panel-buy { margin-top: 16px; }
  .nye-message { margin: 12px 0 0; font-size: 12px; line-height: 1.5; color: rgb(var(--warm)); }
  .nye-fine { margin: 14px 0 0; font-size: 11px; line-height: 1.6; color: rgba(255,255,255,0.4); }

  .nye-buy { display: flex; gap: 10px; align-items: stretch; }
  .nye-stepper {
    display: flex; align-items: center; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; flex-shrink: 0;
  }
  .nye-stepper button {
    width: 44px; height: 52px; background: none; border: 0; color: #fff; font-size: 20px; cursor: pointer;
    font-family: inherit; touch-action: manipulation;
  }
  .nye-stepper button:disabled { opacity: 0.25; cursor: default; }
  .nye-stepper output { min-width: 18px; text-align: center; font-weight: 600; font-size: 16px; font-variant-numeric: tabular-nums; }
  .nye-cta {
    position: relative; overflow: hidden; flex: 1; height: 54px; border-radius: 999px; border: 0;
    background: #fff; color: #000; cursor: pointer; touch-action: manipulation;
    font-family: var(--font-body); font-weight: 600; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase;
    box-shadow: 0 10px 40px -10px rgba(var(--warm),0.6);
    transition: transform .15s, box-shadow .3s, background .3s, color .3s;
  }
  .nye-cta::after {
    content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%;
    background: linear-gradient(100deg, transparent, rgba(var(--warm),0.45), transparent);
    animation: nyeShine 3.2s ease-in-out infinite;
  }
  @keyframes nyeShine { 0% { left: -60%; } 55%, 100% { left: 130%; } }
  .nye-cta:active:not(:disabled) { transform: scale(0.97); }
  .nye-cta:focus-visible { outline: 2px solid rgb(var(--warm)); outline-offset: 3px; }
  .nye-cta:disabled { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.6); cursor: default; box-shadow: none; }
  .nye-cta:disabled::after { display: none; }
  .nye-cta span { position: relative; z-index: 1; }

  /* Ticket stub */
  .nye-stubs { display: grid; gap: 12px; margin-top: 26px; max-width: 460px; }
  .nye-stub {
    position: relative; border-radius: 12px; padding: 18px 18px 16px; color: #000;
    background: linear-gradient(135deg, #fff 0%, #f4efe6 100%);
    -webkit-mask: radial-gradient(circle at 0 62%, transparent 11px, #000 11.5px) left / 51% 100% no-repeat,
                  radial-gradient(circle at 100% 62%, transparent 11px, #000 11.5px) right / 51% 100% no-repeat;
            mask: radial-gradient(circle at 0 62%, transparent 11px, #000 11.5px) left / 51% 100% no-repeat,
                  radial-gradient(circle at 100% 62%, transparent 11px, #000 11.5px) right / 51% 100% no-repeat;
  }
  .nye-stub.is-fresh { animation: nyeStubIn .9s cubic-bezier(.2,.9,.25,1.2); }
  @keyframes nyeStubIn { from { transform: translateY(30px) rotate(-3deg) scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
  .nye-stub-head { display: flex; justify-content: space-between; align-items: baseline; }
  .nye-stub .nye-eyebrow { color: rgba(0,0,0,0.5); margin: 0; }
  .nye-stub-in { font-family: var(--font-display); font-weight: 600; font-size: 22px; line-height: 1; text-transform: uppercase; letter-spacing: -0.01em; }
  .nye-stub-grid {
    display: grid; grid-template-columns: 1fr auto; gap: 10px 16px; margin: 16px 0 0; padding-top: 14px;
    border-top: 1px dashed rgba(0,0,0,0.3);
  }
  .nye-stub-grid div:nth-child(even) { text-align: right; }
  .nye-stub-grid dt { font-size: 9px; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(0,0,0,0.5); }
  .nye-stub-grid dd { margin: 2px 0 0; font-family: var(--font-display); font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
  .nye-mono { font-family: ui-monospace, Menlo, Consolas, monospace !important; letter-spacing: 0.04em; }
  .nye-stub-note { margin: 14px 0 0; font-size: 11px; line-height: 1.5; color: rgba(0,0,0,0.6); }

  /* Marquee */
  .nye-marquee {
    border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    overflow: hidden; white-space: nowrap; padding: 12px 0; margin-bottom: 0;
    font-weight: 500; font-size: 12px; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(255,255,255,0.7);
  }
  .nye-marquee-track { display: inline-flex; animation: nyeMarquee 40s linear infinite; }
  .nye-marquee i { font-style: normal; color: rgb(var(--warm)); margin: 0 0.6em; }
  @keyframes nyeMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

  /* Phones: the buy button stays under the thumb */
  .nye-dock {
    position: sticky; bottom: 0; z-index: 4; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.85) 30%, #000);
  }
  @media (max-width: 899px) { .nye-panel-buy { display: none; } }
  @media (min-width: 900px) { .nye-dock { display: none; } }
  @media (max-width: 899px) { .nye-marquee { margin-bottom: 4px; } }

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
    position: absolute; inset: 0; border: 0; padding: 0; background: rgba(0,0,0,0.72);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: nyeFade .25s ease;
  }
  .nye-sheet {
    position: relative; width: 100%; max-width: 560px; max-height: 94dvh; display: flex; flex-direction: column;
    background: #fff; color: #000; border-radius: 18px 18px 0 0; overflow: hidden;
    animation: nyeUp .38s cubic-bezier(.2,.8,.2,1);
  }
  @media (min-width: 640px) {
    .nye-sheet-wrap { align-items: center; padding: 24px; }
    .nye-sheet { border-radius: 16px; max-height: 90dvh; }
  }
  .nye-sheet-head {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 16px 18px; border-bottom: 1px solid rgba(0,0,0,0.08);
  }
  .nye-sheet-title { margin: 0; font-weight: 600; font-size: 12px; line-height: 1.5; letter-spacing: 0.12em; text-transform: uppercase; }
  .nye-sheet-sub { margin: 3px 0 0; font-size: 12px; color: rgba(0,0,0,0.55); }
  .nye-sheet-close {
    width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(0,0,0,0.06); color: #000;
    font-size: 24px; line-height: 1; cursor: pointer; flex-shrink: 0;
  }
  .nye-sheet-body { overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 8px 0 calc(16px + env(safe-area-inset-bottom, 0px)); min-height: 360px; }
  @keyframes nyeUp { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes nyeFade { from { opacity: 0; } to { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .nye *:not(.nye-flyer-media), .nye *::before, .nye *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    .nye-rise { opacity: 1; transform: none; }
    .nye-marquee-track { animation: none; }
  }
`;

export default Nye;
