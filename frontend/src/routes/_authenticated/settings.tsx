import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { User, KeyRound, Palette, Globe, Database, Webhook, Moon, Sun } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAppDispatch, useAppSelector } from "@/store";
import { toggleTheme } from "@/store/slices/themeSlice";
import { hydrateAuth } from "@/store/slices/authSlice";
import { apiService } from "@/services/api";
import { FieldRenderer } from "@/components/workspace/FieldRenderer";
import { defaultSiteFields, defaultSiteDefaults, validateDefaultSite } from "@/lib/nodeSchemas";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings · ProxyForge" },
      { name: "description", content: "Account, appearance, and integration settings." },
    ],
  }),
  component: SettingsPage,
});

const SECTIONS = [
  { id: "profile", label: "Profile", desc: "Your name, email, and role", icon: User },
  { id: "security", label: "Security", desc: "Password", icon: KeyRound },
  { id: "appearance", label: "Appearance", desc: "Theme", icon: Palette },
  { id: "default-site", label: "Default Site", desc: "Fallback for unmatched hosts", icon: Globe },
  { id: "retention", label: "Retention", desc: "Log & cache cleanup", icon: Database },
  { id: "api-tokens", label: "API Tokens", desc: "CI/CD access", icon: Webhook },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function SettingsPage() {
  const user = useAppSelector((s) => s.auth.user);
  const token = useAppSelector((s) => s.auth.token);
  const theme = useAppSelector((s) => s.theme.mode);
  const dispatch = useAppDispatch();

  const [active, setActive] = useState<SectionId>("profile");

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [defaultSite, setDefaultSite] = useState<Record<string, unknown>>(defaultSiteDefaults);
  const [defaultSiteErrors, setDefaultSiteErrors] = useState<Record<string, string>>({});
  const [savingDefaultSite, setSavingDefaultSite] = useState(false);
  const [loadingDefaultSite, setLoadingDefaultSite] = useState(true);

  const [retentionDays, setRetentionDays] = useState(30);
  const [savingRetention, setSavingRetention] = useState(false);
  const [loadingRetention, setLoadingRetention] = useState(true);

  useEffect(() => {
    apiService
      .getSettings()
      .then((s) => {
        const saved = s.defaultSite as Record<string, unknown> | undefined;
        if (saved) setDefaultSite({ ...defaultSiteDefaults, ...saved });
        const retention = s.retention as { days?: number } | undefined;
        if (retention?.days) setRetentionDays(retention.days);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load settings");
      })
      .finally(() => {
        setLoadingDefaultSite(false);
        setLoadingRetention(false);
      });
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await apiService.updateProfile({ name, email });
      if (token) dispatch(hydrateAuth({ user: updated, token }));
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setSavingPassword(true);
    try {
      await apiService.changePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  const saveDefaultSite = async () => {
    const result = validateDefaultSite(defaultSite);
    if (!result.ok) {
      setDefaultSiteErrors(result.errors);
      toast.error("Fix the highlighted field before saving");
      return;
    }
    setDefaultSiteErrors({});
    setSavingDefaultSite(true);
    try {
      const res = await apiService.updateSettings({ defaultSite });
      if ((res as { warning?: string }).warning) {
        toast.warning((res as { warning?: string }).warning as string);
      } else {
        toast.success("Default Site updated");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update Default Site");
    } finally {
      setSavingDefaultSite(false);
    }
  };

  const saveRetention = async () => {
    if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      toast.error("Retention must be between 1 and 3650 days");
      return;
    }
    setSavingRetention(true);
    try {
      await apiService.updateSettings({ retention: { days: retentionDays } });
      toast.success("Retention settings updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update retention settings");
    } finally {
      setSavingRetention(false);
    }
  };

  const activeMeta = SECTIONS.find((s) => s.id === active)!;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account and workspace preferences.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="lg:w-56 lg:shrink-0">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === active;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setActive(s.id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap lg:whitespace-normal">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 max-w-2xl">
          <div className="mb-4">
            <div className="text-sm font-medium">{activeMeta.label}</div>
            <p className="text-xs text-muted-foreground">{activeMeta.desc}</p>
          </div>

          {active === "profile" && (
            <Card className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <div>
                    <Badge variant="outline" className="capitalize">
                      {user?.role ?? "—"}
                    </Badge>
                  </div>
                </div>
              </div>
              <Separator />
              <div>
                <Button size="sm" onClick={saveProfile} disabled={savingProfile}>
                  {savingProfile ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </Card>
          )}

          {active === "security" && (
            <Card className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>New password</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confirm password</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
              <Separator />
              <div>
                <Button size="sm" onClick={savePassword} disabled={savingPassword}>
                  {savingPassword ? "Saving…" : "Update password"}
                </Button>
              </div>
            </Card>
          )}

          {active === "appearance" && (
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                    {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">Dark mode</div>
                    <div className="text-xs text-muted-foreground capitalize">Current: {theme}</div>
                  </div>
                </div>
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={() => dispatch(toggleTheme())}
                />
              </div>
            </Card>
          )}

          {active === "default-site" && (
            <Card className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground">
                What nginx serves on ports 80/443 when a request's Host header doesn't match any
                deployed domain.
              </p>
              <div className="space-y-4">
                {defaultSiteFields.map((field) => (
                  <FieldRenderer
                    key={field.key}
                    field={field}
                    value={defaultSite[field.key]}
                    values={defaultSite}
                    error={defaultSiteErrors[field.key]}
                    onChange={(v) => setDefaultSite((prev) => ({ ...prev, [field.key]: v }))}
                  />
                ))}
              </div>
              <Separator />
              <div>
                <Button
                  size="sm"
                  onClick={saveDefaultSite}
                  disabled={savingDefaultSite || loadingDefaultSite}
                >
                  {savingDefaultSite ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </Card>
          )}

          {active === "retention" && (
            <Card className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground">
                Access/error logs, activity log entries, and stale nginx proxy cache files older
                than this are deleted automatically, once a day.
              </p>
              <div className="max-w-xs space-y-2">
                <Label>Retention period (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                />
              </div>
              <Separator />
              <div>
                <Button
                  size="sm"
                  onClick={saveRetention}
                  disabled={savingRetention || loadingRetention}
                >
                  {savingRetention ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </Card>
          )}

          {active === "api-tokens" && (
            <Card className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground">
                Personal API tokens for CI/CD workflows — not implemented yet.
              </p>
              <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                No tokens yet. Generate one to script deployments from CI.
              </div>
              <Button size="sm" variant="outline" disabled>
                Generate token
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
