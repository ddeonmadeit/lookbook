// Cookie-backed storage for the Supabase auth session, so the admin login
// persists reliably (some mobile/in-app browsers clear localStorage far more
// aggressively than cookies) and the owner doesn't have to sign in every
// visit. Only ever holds the auth session — the storefront (cart, browsing)
// never creates a Supabase session, so this has no effect outside /admin.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

function isSecureContext() {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

export const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(key)}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  },
  setItem(key: string, value: string): void {
    if (typeof document === "undefined") return;
    const secure = isSecureContext() ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  },
  removeItem(key: string): void {
    if (typeof document === "undefined") return;
    document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`;
  },
};
