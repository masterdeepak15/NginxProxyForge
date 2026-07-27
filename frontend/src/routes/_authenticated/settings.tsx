import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

function SettingsPage() {
  const user = useAppSelector((s) => s.auth.user);
  const token = useAppSelector((s) => s.auth.token);
  const theme = useAppSelector((s) => s.theme.mode);
  const dispatch = useAppDispatch();

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

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account and workspace preferences.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="text-sm font-medium">Profile</div>
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
            <Input defaultValue={user?.role ?? ""} disabled />
          </div>
        </div>
        <div>
          <Button size="sm" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="text-sm font-medium">Password</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>New password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
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
        <div>
          <Button size="sm" onClick={savePassword} disabled={savingPassword}>
            {savingPassword ? "Saving…" : "Update password"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="text-sm font-medium">Appearance</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">Dark mode</div>
            <div className="text-xs text-muted-foreground">Current: {theme}</div>
          </div>
          <Switch checked={theme === "dark"} onCheckedChange={() => dispatch(toggleTheme())} />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div>
          <div className="text-sm font-medium">Default Site</div>
          <p className="text-xs text-muted-foreground">
            What nginx serves on ports 80/443 when a request's Host header doesn't match any
            deployed domain.
          </p>
        </div>
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

      <Card className="p-6 space-y-4">
        <div>
          <div className="text-sm font-medium">Log & Cache Retention</div>
          <p className="text-xs text-muted-foreground">
            Access/error logs, activity log entries, and stale nginx proxy cache files older than
            this are deleted automatically, once a day.
          </p>
        </div>
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
        <div>
          <Button size="sm" onClick={saveRetention} disabled={savingRetention || loadingRetention}>
            {savingRetention ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="text-sm font-medium">API tokens</div>
        <p className="text-xs text-muted-foreground">
          Personal API tokens for CI/CD workflows — not implemented yet.
        </p>
        <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
          No tokens yet. Generate one to script deployments from CI.
        </div>
        <Button size="sm" variant="outline" disabled>
          Generate token
        </Button>
      </Card>
    </div>
  );
}
