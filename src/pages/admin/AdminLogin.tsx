import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
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
          <Label htmlFor="email" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-[10px] uppercase tracking-[0.15em] font-body text-muted-foreground">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" disabled={submitting} className="w-full h-11 text-[11px] uppercase tracking-[0.2em] font-body">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </Button>
        <p className="font-body text-[10px] text-muted-foreground text-center leading-relaxed">
          Accounts are created in the Supabase dashboard. Public sign-up is disabled.
        </p>
      </form>
    </div>
  );
};

export default AdminLogin;
