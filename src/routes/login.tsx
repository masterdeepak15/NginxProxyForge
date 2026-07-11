import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Zap, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAppDispatch, useAppSelector } from "@/store";
import { login } from "@/store/slices/authSlice";
import { store } from "@/store";

export const Route = createFileRoute("/login")({
  ssr: false,
  beforeLoad: () => {
    if (store.getState().auth.token) {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in · ProxyForge" },
      { name: "description", content: "Sign in to your ProxyForge account." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error } = useAppSelector((s) => s.auth);
  const [email, setEmail] = useState("admin@proxyforge.io");
  const [password, setPassword] = useState("admin123");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await dispatch(login({ email, password }));
    if (login.fulfilled.match(res)) {
      navigate({ to: "/dashboard" });
    }
  };

  return (
    <div className="relative flex min-h-screen w-full bg-background text-foreground">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-primary/10 via-background to-background p-10 lg:flex">
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">ProxyForge</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Visual Nginx Infrastructure
            </div>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Design, deploy, and operate Nginx —{" "}
            <span className="text-primary">visually.</span>
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Build reverse-proxy fleets as node graphs. Every config is generated,
            validated with <code className="rounded bg-muted px-1 py-0.5 text-xs">nginx -t</code>,
            and reversible in one click.
          </p>
          <div className="grid max-w-md grid-cols-3 gap-4 pt-4">
            {[
              { k: "0", label: "hand-written configs" },
              { k: "100%", label: "validated deploys" },
              { k: "1-click", label: "rollbacks" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border/60 bg-card/40 p-3 backdrop-blur">
                <div className="text-xl font-semibold">{s.k}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-muted-foreground">
          © 2026 ProxyForge · All infra, no drama.
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Zap className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">ProxyForge</span>
          </div>

          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to your control plane.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Forgot?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={status === "loading"}>
              {status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <div className="rounded-md border border-dashed border-border/70 bg-muted/40 p-3 text-xs">
            <div className="font-medium text-foreground">Demo credentials</div>
            <div className="mt-1 space-y-0.5 text-muted-foreground">
              <div>admin@proxyforge.io · admin123</div>
              <div>ops@proxyforge.io · ops123</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
