import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  /** Persist the new name. Return true on success (closes the dialog) or
   * false on failure (dialog stays open so the user can retry) — the
   * caller is responsible for its own error toast, same as the other
   * workflow dialogs in this app. */
  onSave: (name: string) => Promise<boolean>;
}

export function RenameWorkflowDialog({ open, onOpenChange, currentName, onSave }: Props) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  // Reset the field to the latest name every time the dialog is (re)opened.
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const unchanged = trimmed === currentName.trim();

  const handleSave = async () => {
    if (!trimmed) return;
    if (unchanged) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(trimmed);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !trimmed || unchanged}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
