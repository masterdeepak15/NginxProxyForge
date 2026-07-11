import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAppDispatch, useAppSelector } from "@/store";
import { toggleTheme } from "@/store/slices/themeSlice";

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
  const theme = useAppSelector((s) => s.theme.mode);
  const dispatch = useAppDispatch();

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
            <Input defaultValue={user?.name ?? ""} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input defaultValue={user?.email ?? ""} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Input defaultValue={user?.role ?? ""} disabled />
          </div>
        </div>
        <div>
          <Button size="sm">Save changes</Button>
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
          Personal API tokens for CI/CD workflows.
        </p>
        <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
          No tokens yet. Generate one to script deployments from CI.
        </div>
        <Button size="sm" variant="outline">Generate token</Button>
      </Card>
    </div>
  );
}
