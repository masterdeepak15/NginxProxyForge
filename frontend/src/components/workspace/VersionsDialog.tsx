import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiService
      .getWorkflowVersions(workflowId)
      .then(setVersions)
      .finally(() => setLoading(false));
  }, [open, workflowId]);

  return (
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
                  v{v.version} {i === 0 && <span className="text-xs text-muted-foreground">(current)</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {v.author} · {new Date(v.updatedAt).toLocaleString()}
                  {v.message ? ` · ${v.message}` : ""}
                </div>
              </div>
              {i !== 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRollback(v.version)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
