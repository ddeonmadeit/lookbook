import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Supabase Auth logs in by email. We let the owner sign in with a simple
// username ("admin") and map it to a fixed internal email address.
const ADMIN_EMAIL_DOMAIN = "lookbook.app";

function usernameToEmail(input: string) {
  const value = input.trim();
  return value.includes("@") ? value : `${value}@${ADMIN_EMAIL_DOMAIN}`;
}

const AdminLogin = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/admin", { replace: true });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const email = usernameToEmail(username);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error("Sign in failed", { description: error.message });
        return;
      }
      navigate("/admin", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full bg-background flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-5">
        <div className="text-center mb-2">
          <h1 className="font-display text-sm uppercase tracking-[0.2em]">Admin</h1>
          <p className="font-body text-[10px] text-muted-foreground mt-1 uppercase tracking-[0.1em]">
            Store dashboard
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="username" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Username</Label>
          <Input id="username" type="text" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting} className="w-full h-11 text-[11px] uppercase tracking-[0.2em] font-body">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </Button>
      </form>
    </div>
  );
};

export default AdminLogin;
