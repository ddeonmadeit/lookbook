import { useEffect } from "react";
import { toast } from "sonner";

// How often a dashboard left open checks for a new version.
const CHECK_EVERY_MS = 15 * 60 * 1000;

/**
 * Keep the dashboard on the latest version. The site works offline through a
 * service worker, so a phone keeps running the copy it saved until the app
 * is fully restarted — which an app on the home screen almost never is. This
 * checks for a new version on open, whenever the app comes back to the
 * foreground and every so often, and switches to it as soon as it's ready —
 * or, if a form is open, as soon as it's closed, so unsaved work is never lost.
 *
 * Dashboard only: shoppers are never reloaded mid-checkout.
 */
export function useAppUpdates() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    // The very first install also hands over control; that's not an update.
    let hadController = !!sw.controller;
    let reloading = false;
    let waitForForm: number | undefined;
    const formOpen = () => !!document.querySelector("[role=dialog]");

    const reload = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const onControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (!formOpen()) {
        reload();
        return;
      }
      toast("A new version of the dashboard is ready", {
        description: "It'll load as soon as you close this window.",
        duration: Infinity,
      });
      window.clearInterval(waitForForm);
      waitForForm = window.setInterval(() => {
        if (!formOpen()) reload();
      }, 800);
    };

    const check = () => {
      sw.getRegistration()
        .then((r) => r?.update())
        .catch(() => {
          // offline or the check failed; try again next time
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    sw.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisible);
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      window.clearInterval(waitForForm);
    };
  }, []);
}
