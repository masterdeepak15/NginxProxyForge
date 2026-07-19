import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
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
            <div className="text-xs text-muted-foreground">
              Current: {theme}
            </div>
          </div>
          <Switch
            checked={theme === "dark"}
            onCheckedChange={() => dispatch(toggleTheme())}
          />
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
