import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Trash2 } from "lucide-react";
import { apiService } from "@/services/api";

interface VersionEntry {
  version: number;
  updatedAt: string;
  author: string;
  message?: string;
}

interface Props {
  workflowId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRollback: (toVersion: number) => void;
}

export function VersionsDialog({ workflowId, open, onOpenChange, onRollback }: Props) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiService
      .getWorkflowVersions(workflowId)
      .then(setVersions)
      .finally(() => setLoading(false));
  }, [workflowId]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const handleDelete = async () => {
    if (deleteTarget === null) return;
    setDeleting(true);
    try {
      await apiService.deleteWorkflowVersion(workflowId, deleteTarget);
      toast.success(`Deleted v${deleteTarget}`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete version");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-1 overflow-auto">
            {loading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
            {!loading && versions.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No versions yet.</div>
            )}
            {versions.map((v, i) => (
              <div
                key={v.version}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">
                    v{v.version}{" "}
                    {i === 0 && <span className="text-xs text-muted-foreground">(current)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v.author} · {new Date(v.updatedAt).toLocaleString()}
                    {v.message ? ` · ${v.message}` : ""}
                  </div>
                </div>
                {i !== 0 && (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => onRollback(v.version)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteTarget(v.version)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete v{deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this version snapshot and any deployment log entries recorded
              against it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
