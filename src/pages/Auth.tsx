import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const Auth = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/onboarding");
      } else {
        const redirectUrl = `${window.location.origin}/`;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectUrl },
        });
        if (error) throw error;
        navigate("/onboarding");
      }
    } catch (e: any) {
      setError(e?.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-page flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader>
          <CardTitle>{mode === "login" ? "Log in" : "Sign up"}</CardTitle>
          <CardDescription>Use email and password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <Button onClick={onSubmit} disabled={loading} className="w-full">{loading ? "Please wait..." : (mode === "login" ? "Log in" : "Create account")}</Button>
            </div>
            <div className="text-sm text-muted-foreground text-center">
              {mode === "login" ? (
                <button className="underline" onClick={() => setMode("signup")}>Need an account? Sign up</button>
              ) : (
                <button className="underline" onClick={() => setMode("login")}>Already have an account? Log in</button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
