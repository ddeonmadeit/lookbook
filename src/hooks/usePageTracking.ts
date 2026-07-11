import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Self-hosted, cookie-free page-view tracking for the admin dashboard.
// A random id per browser session groups views into visits; nothing
// identifies the visitor.

function getSessionId(): string {
  const KEY = "knots_session";
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id =
        globalThis.crypto?.randomUUID?.() ??
        `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    // Don't count the owner working in the dashboard as traffic.
    if (location.pathname.startsWith("/admin")) return;

    const device = window.innerWidth < 768 ? "mobile" : "desktop";
    const referrer =
      document.referrer && !document.referrer.includes(window.location.hostname)
        ? document.referrer
        : null;

    // Fire and forget — analytics must never slow down or break the page.
    supabase
      .from("page_views")
      .insert({
        session_id: getSessionId(),
        path: location.pathname,
        referrer,
        device,
      })
      .then(({ error }) => {
        if (error) console.debug("page view not recorded:", error.message);
      });
  }, [location.pathname]);
}
