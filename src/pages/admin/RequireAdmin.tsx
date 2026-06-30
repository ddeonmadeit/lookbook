import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import loadingSpinner from "@/assets/loading-spinner.gif";

/**
 * Gate around the admin dashboard. Any authenticated Supabase user counts as an
 * admin — create the owner account in the Supabase dashboard (Authentication →
 * Users) and keep public sign-ups disabled so nobody else can get in.
 */
const RequireAdmin = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <img src={loadingSpinner} alt="Loading" className="w-12 h-12 object-contain" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
};

export default RequireAdmin;
