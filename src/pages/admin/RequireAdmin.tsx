import { Navigate } from "react-router-dom";
import { useAdminSession } from "@/hooks/useAdminSession";
import loadingSpinner from "@/assets/loading-spinner.gif";

/**
 * Gate around the admin dashboard. Any authenticated Supabase user counts as an
 * admin — create the owner account in the Supabase dashboard (Authentication →
 * Users) and keep public sign-ups disabled so nobody else can get in.
 */
const RequireAdmin = ({ children }: { children: React.ReactNode }) => {
  const { hasSession, checked } = useAdminSession();

  if (!checked) {
    return (
      <div className="h-full bg-background flex items-center justify-center">
        <img src={loadingSpinner} alt="Loading" className="w-12 h-12 object-contain" />
      </div>
    );
  }

  if (!hasSession) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
};

export default RequireAdmin;
