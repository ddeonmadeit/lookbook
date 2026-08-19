import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import bgMobile from "@/assets/coming-soon/bg-mobile.png";
import bgDesktop from "@/assets/coming-soon/bg-desktop.png";
import preloaderGif from "@/assets/coming-soon/preloader.gif";
import faviconSvg from "@/assets/coming-soon/favicon.svg";
import wcManoNegraFont from "@/assets/coming-soon/fonts/WCManoNegraBta.otf";
import alteHaasBoldFont from "@/assets/coming-soon/fonts/AlteHaasGroteskBold.ttf";
import alteHaasRegularFont from "@/assets/coming-soon/fonts/AlteHaasGroteskRegular.ttf";

// AW26 drop date — early-access countdown target.
const TARGET = new Date("2026-09-24T00:00:00Z").getTime();

function pad(n: number) {
  return String(n).padStart(2, "0");
}

const STYLE = `
  .aw26-page, .aw26-page *, .aw26-page *::before, .aw26-page *::after {
    box-sizing: border-box;
  }

  @font-face {
    font-family: 'AW26ManoNegra';
    src: url('${wcManoNegraFont}') format('opentype');
    font-weight: normal;
    font-display: block;
  }
  @font-face {
    font-family: 'AW26AlteHaas';
    src: url('${alteHaasBoldFont}') format('truetype');
    font-weight: 700;
    font-display: block;
  }
  @font-face {
    font-family: 'AW26AlteHaas';
    src: url('${alteHaasRegularFont}') format('truetype');
    font-weight: 400;
    font-display: block;
  }

  .aw26-page {
    position: fixed;
    inset: 0;
    color: #fff;
    background: #0c2d45;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    overscroll-behavior: none;
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    z-index: 0;
  }

  .aw26-bg {
    position: fixed;
    top: -50px; left: -50px; right: -50px; bottom: -200px;
    background-color: #0c2d45;
    background-image: url('${bgMobile}');
    background-size: cover;
    background-position: center center;
    z-index: 0;
  }
  @media (min-width: 768px) {
    .aw26-bg { background-image: url('${bgDesktop}'); }
  }

  .aw26-preloader, .aw26-container {
    position: relative;
    z-index: 1;
  }

  .aw26-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    width: 100%;
    max-width: 680px;
    padding: 0 28px;
  }

  .aw26-logo {
    width: 50px;
    height: auto;
    margin-bottom: 12px;
  }
  @media (min-width: 768px) {
    .aw26-logo { width: 72px; margin-bottom: 18px; }
  }

  .aw26-title {
    font-family: 'AW26ManoNegra', serif;
    font-size: clamp(78px, 20vw, 128px);
    line-height: 0.9;
    color: #fff;
    margin-bottom: -6px;
  }

  .aw26-countdown {
    display: flex;
    gap: clamp(16px, 4vw, 50px);
    justify-content: center;
    align-items: flex-start;
    margin-bottom: clamp(64px, 11vh, 90px);
  }

  .aw26-countdown-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }

  .aw26-countdown-number {
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 700;
    font-size: clamp(42px, 11vw, 66px);
    line-height: 1;
    min-width: 2.2ch;
    text-align: center;
  }

  .aw26-countdown-label {
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 700;
    font-size: clamp(9px, 2vw, 12px);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0.8;
  }

  @keyframes aw26FlipOut {
    0%   { transform: perspective(400px) rotateX(0deg);   opacity: 1; }
    100% { transform: perspective(400px) rotateX(-90deg); opacity: 0; }
  }
  @keyframes aw26FlipIn {
    0%   { transform: perspective(400px) rotateX(90deg);  opacity: 0; }
    100% { transform: perspective(400px) rotateX(0deg);   opacity: 1; }
  }
  .aw26-flip-out { animation: aw26FlipOut 0.17s ease-in forwards; }
  .aw26-flip-in  { animation: aw26FlipIn  0.17s ease-out forwards; }

  .aw26-early-access {
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 700;
    font-size: clamp(15px, 1.8vw, 16px);
    letter-spacing: 0.28em;
    text-transform: uppercase;
    margin-bottom: 14px;
  }

  .aw26-form-row {
    display: flex;
    gap: 9px;
    width: 100%;
    max-width: 510px;
    margin-bottom: 12px;
  }

  .aw26-phone-input {
    flex: 1;
    height: 52px;
    border: 1.5px solid rgba(255, 255, 255, 0.65);
    border-radius: 14px;
    background: rgba(28, 75, 108, 0.52);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    color: #fff;
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 400;
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0 18px;
    outline: none;
    touch-action: manipulation;
    -webkit-appearance: none;
    appearance: none;
    min-width: 0;
  }
  .aw26-phone-input::placeholder {
    color: rgba(255, 255, 255, 0.48);
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 400;
    letter-spacing: 0.12em;
  }
  .aw26-phone-input:focus {
    border-color: rgba(255, 255, 255, 0.9);
    background: rgba(28, 75, 108, 0.68);
  }

  .aw26-submit-btn {
    height: 52px;
    padding: 0 22px;
    flex-shrink: 0;
    border: none;
    border-radius: 14px;
    background: #fff;
    color: #0c2d45;
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
    touch-action: manipulation;
    white-space: nowrap;
    transition: opacity 0.15s;
    -webkit-appearance: none;
    appearance: none;
  }
  .aw26-submit-btn:active { opacity: 0.78; }
  .aw26-submit-btn:disabled { opacity: 0.55; cursor: default; }

  .aw26-status {
    font-family: 'AW26AlteHaas', sans-serif;
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    min-height: 16px;
  }
  .aw26-status.success { color: #7dd3d3; }
  .aw26-status.error   { color: #ff8f8f; }

  .aw26-preloader {
    position: fixed;
    inset: 0;
    background: #0c2d45;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
    transition: opacity 0.6s ease;
  }
  .aw26-preloader.fade-out {
    opacity: 0;
    pointer-events: none;
  }
  .aw26-preloader img {
    width: 140px;
    height: auto;
    filter: invert(1);
  }

  @keyframes aw26FadeUp {
    from { opacity: 0; translate: 0 20px; }
    to   { opacity: 1; translate: 0 0px; }
  }
  .aw26-fu { opacity: 0; animation: aw26FadeUp 0.6s ease forwards; }
  .aw26-fu-1 { animation-delay: 0.05s; }
  .aw26-fu-2 { animation-delay: 0.15s; }
  .aw26-fu-3 { animation-delay: 0.27s; }
  .aw26-fu-4 { animation-delay: 0.42s; }
  .aw26-fu-5 { animation-delay: 0.54s; }
  .aw26-fu-6 { animation-delay: 0.64s; }
`;

const ComingSoon = () => {
  const [preloaderDone, setPreloaderDone] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: "success" | "error" | null }>({
    text: "",
    kind: null,
  });

  const daysRef = useRef<HTMLDivElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);
  const secondsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<HTMLDivElement>(null);

  // Tab title/icon while this gate is shown.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Knots Natural Streetwear";
    let iconLink = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    const prevHref = iconLink?.getAttribute("href") ?? null;
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }
    iconLink.setAttribute("href", faviconSvg);
    return () => {
      document.title = prevTitle;
      if (iconLink && prevHref !== null) iconLink.setAttribute("href", prevHref);
    };
  }, []);

  // Preloader: wait for fonts + images, fall back after 4s regardless.
  useEffect(() => {
    let cancelled = false;
    function waitForImage(src: string) {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = src;
      });
    }
    Promise.all([document.fonts.ready, waitForImage(bgMobile), waitForImage(bgDesktop), waitForImage(preloaderGif)]).then(
      () => {
        if (!cancelled) setTimeout(() => !cancelled && setPreloaderDone(true), 300);
      },
    );
    const fallback = setTimeout(() => !cancelled && setPreloaderDone(true), 4000);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  // Block pull-to-refresh / rubber-band while this page is mounted, allow input scrolling.
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (!(e.target as HTMLElement)?.closest("input, textarea")) e.preventDefault();
    };
    document.addEventListener("touchmove", handler, { passive: false });
    return () => document.removeEventListener("touchmove", handler);
  }, []);

  // Scale the AW26 title to match the countdown row width.
  useEffect(() => {
    function alignTitle() {
      const title = titleRef.current;
      const countdown = countdownRef.current;
      if (!title || !countdown) return;
      title.style.transform = "";
      const scale = countdown.offsetWidth / title.offsetWidth;
      if (scale > 1) title.style.transform = `scaleX(${scale.toFixed(4)})`;
    }
    document.fonts.ready.then(() => {
      alignTitle();
      setTimeout(alignTitle, 150);
    });
    window.addEventListener("resize", alignTitle);
    return () => window.removeEventListener("resize", alignTitle);
  }, []);

  // Countdown ticker with flip animation, driven directly via refs (matches the
  // original vanilla-JS timing rather than fighting React re-renders every second).
  useEffect(() => {
    const els = {
      days: daysRef.current,
      hours: hoursRef.current,
      minutes: minutesRef.current,
      seconds: secondsRef.current,
    };

    function flipTo(el: HTMLDivElement | null, val: string) {
      if (!el || el.textContent === val) return;
      el.classList.remove("aw26-flip-in", "aw26-flip-out");
      void el.offsetWidth;
      el.classList.add("aw26-flip-out");
      setTimeout(() => {
        el.textContent = val;
        el.classList.remove("aw26-flip-out");
        void el.offsetWidth;
        el.classList.add("aw26-flip-in");
      }, 170);
    }

    function tick() {
      const diff = Math.max(0, TARGET - Date.now());
      flipTo(els.days, pad(Math.floor(diff / 86400000)));
      flipTo(els.hours, pad(Math.floor((diff % 86400000) / 3600000)));
      flipTo(els.minutes, pad(Math.floor((diff % 3600000) / 60000)));
      flipTo(els.seconds, pad(Math.floor((diff % 60000) / 1000)));
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async () => {
    const cleaned = phone.trim();
    if (!cleaned) {
      setStatus({ text: "Please enter your phone number.", kind: "error" });
      return;
    }
    setSubmitting(true);
    setStatus({ text: "", kind: null });
    try {
      const { error } = await supabase.from("phone_signups").insert({ phone: cleaned });
      if (error && error.code !== "23505") {
        // 23505 = unique_violation (already signed up) — treat like the original server did: success.
        setStatus({ text: error.message || "Something went wrong.", kind: "error" });
        return;
      }
      setStatus({ text: "You're on the list.", kind: "success" });
      setPhone("");
    } catch {
      setStatus({ text: "Connection error. Please try again.", kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="aw26-page">
      <style>{STYLE}</style>
      <div className="aw26-bg" />
      <div className={`aw26-preloader${preloaderDone ? " fade-out" : ""}`} style={preloaderDone ? { display: "none" } : undefined}>
        <img src={preloaderGif} alt="" />
      </div>

      <div className="aw26-container">
        <svg
          className="aw26-logo aw26-fu aw26-fu-1"
          viewBox="0 0 367.13 323.71"
          xmlns="http://www.w3.org/2000/svg"
          fill="white"
          aria-label="KNOTS logo"
        >
          <path d="M.44,163.08c21.21,10.31,43.86,13.7,66.91,6.72,11.09-3.36,21.37-8.44,30.62-15.37,11.55-8.66,20.37-19.87,26.53-32.87,9.03-19.06,11.16-40.51,6.02-60.93-6.84-27.14-25.65-49.07-51.86-59.98,9.25-1.3,18.36-.56,27.45,1.46,20.12,4.48,38.4,14.98,52.45,30.04,12.32,23.21,20.44,29.22,24.51,47.23,6.8-24.46,19.39-43.79,40.09-58.74,17.04-12.31,37.25-19.3,58.69-19.25-18.22,9.8-32.49,23.17-41.46,41.78-4.34,9-7.17,18.29-8.7,28.2-2.79,18.01.32,36.04,8.66,52.2,8.12,15.74,19.68,28.62,35.41,37.03,11.63,6.22,24.23,9.9,37.46,10.93,19.35,1.51,37.16-3.82,53.92-13.71-13.13,22.42-34.29,37.34-58.89,44.57-18.8,5.53-37.48,4.98-56.7-.33,31.7,37.23,36.16,77.36,14.66,121.11-.18.63-.58.78-.54.07.89-25-6.2-47.59-23.01-65.93-19.95-21.77-44.67-31.37-74.23-28.58-19.6,1.85-37.61,10.18-51.88,23.65l-4.43,4.42c-16.64,16.6-25.67,41.19-24.96,65.36-3.66-5.6-6.21-11.61-7.99-17.89-10.2-36.1-.47-74.58,26.1-101.65-43.53,8.01-77.82-4.83-104.97-39.11l-.26-.32-.02-.44.44.32ZM207.7,175.59c-12.98-13.97-21.39-30.21-25.66-48.96-4.94,18.18-13.88,34.11-27.26,47.79,18.01-3.97,35.37-3.67,52.92,1.17Z" />
        </svg>

        <div ref={titleRef} className="aw26-title aw26-fu aw26-fu-2">
          AW26
        </div>

        <div ref={countdownRef} className="aw26-countdown aw26-fu aw26-fu-3">
          <div className="aw26-countdown-col">
            <div ref={daysRef} className="aw26-countdown-number">00</div>
            <div className="aw26-countdown-label">Days</div>
          </div>
          <div className="aw26-countdown-col">
            <div ref={hoursRef} className="aw26-countdown-number">00</div>
            <div className="aw26-countdown-label">Hours</div>
          </div>
          <div className="aw26-countdown-col">
            <div ref={minutesRef} className="aw26-countdown-number">00</div>
            <div className="aw26-countdown-label">Minutes</div>
          </div>
          <div className="aw26-countdown-col">
            <div ref={secondsRef} className="aw26-countdown-number">00</div>
            <div className="aw26-countdown-label">Seconds</div>
          </div>
        </div>

        <div className="aw26-early-access aw26-fu aw26-fu-4">Early Access</div>

        <div className="aw26-form-row aw26-fu aw26-fu-5">
          <input
            type="tel"
            className="aw26-phone-input"
            placeholder="PHONE NUMBER"
            inputMode="tel"
            autoComplete="tel"
            autoCorrect="off"
            autoCapitalize="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <button className="aw26-submit-btn" disabled={submitting} onClick={handleSubmit}>
            Submit
          </button>
        </div>

        <div className={`aw26-status${status.kind ? ` ${status.kind}` : ""} aw26-fu aw26-fu-6`}>{status.text}</div>
      </div>
    </div>
  );
};

export default ComingSoon;
