import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, Search, Workflow as WorkflowIcon, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  fetchWorkflows,
  createWorkflowThunk,
  deleteWorkflowThunk,
} from "@/store/slices/workflowsSlice";
import { apiService } from "@/services/api";

export const Route = createFileRoute("/_authenticated/workspace/")({
  head: () => ({
    meta: [
      { title: "Workspace - ProxyForge" },
      { name: "description", content: "Browse and design your Nginx workflows." },
    ],
  }),
  component: WorkspaceIndex,
});

function WorkspaceIndex() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { items, status } = useAppSelector((s) => s.workflows);
  const [q, setQ] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState("");
  const [importConfig, setImportConfig] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (items.length === 0) dispatch(fetchWorkflows());
  }, [dispatch, items.length]);

  const filtered = items.filter(
    (w) =>
      w.name.toLowerCase().includes(q.toLowerCase()) ||
      w.domains.some((d) => d.toLowerCase().includes(q.toLowerCase())),
  );

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error("Name is required");
      return;
    }
    setCreating(true);
    try {
      const workflow = await dispatch(
        createWorkflowThunk({ name: newName.trim(), description: newDescription.trim() }),
      ).unwrap();
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      navigate({ to: "/workspace/$id", params: { id: workflow.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workflow");
    } finally {
      setCreating(false);
    }
  };

  const handleFilesPicked = (files: FileList | null) => {
    if (!files || !files.length) return;
    setImportFiles(Array.from(files));
  };

  const handleImport = async () => {
    // Multiple (or one) files picked -> one workflow per file, named after
    // the filename. This is the common case migrating off Nginx Proxy
    // Manager, which exports one .conf per proxy host.
    if (importFiles.length > 0) {
      setImporting(true);
      let created = 0;
      let totalWarnings = 0;
      let lastId: string | null = null;
      const failures: string[] = [];
      for (const file of importFiles) {
        try {
          const text = await file.text();
          const name = file.name.replace(/\.conf$/i, "");
          const { workflow, warnings } = await apiService.importWorkflow(name, text);
          created += 1;
          totalWarnings += warnings.length;
          lastId = workflow.id;
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
      setImporting(false);
      setImportOpen(false);
      setImportFiles([]);
      setImportName("");
      setImportConfig("");
      dispatch(fetchWorkflows());
      if (created > 0) {
        toast.success(`Imported ${created} workflow${created === 1 ? "" : "s"}`, {
          description:
            totalWarnings > 0
              ? `${totalWarnings} note(s) across the imported files — open each workflow to review.`
              : undefined,
          duration: 10000,
        });
      }
      if (failures.length) {
        toast.error(`${failures.length} file(s) failed to import`, {
          description: failures.join("\n"),
          duration: 15000,
        });
      }
      if (created === 1 && !failures.length && lastId) {
        navigate({ to: "/workspace/$id", params: { id: lastId } });
      }
      return;
    }

    // Fallback: pasted config text, one workflow.
    if (!importName.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!importConfig.trim()) {
      toast.error("Paste or upload a .conf file first");
      return;
    }
    setImporting(true);
    try {
      const { workflow, warnings } = await apiService.importWorkflow(
        importName.trim(),
        importConfig,
      );
      setImportOpen(false);
      setImportName("");
      setImportConfig("");
      if (warnings.length) {
        toast.warning(`Imported with ${warnings.length} note(s)`, {
          description: warnings.join("\n"),
          duration: 15000,
        });
      } else {
        toast.success("Config imported");
      }
      dispatch(fetchWorkflows());
      navigate({ to: "/workspace/$id", params: { id: workflow.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await dispatch(deleteWorkflowThunk(deleteTarget.id)).unwrap();
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete workflow");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every workflow is a visual graph that compiles to validated Nginx config.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import .conf
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New workflow
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search workflows or domains..."
          className="pl-9"
        />
      </div>

      {status === "loading" && items.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-40 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No workflows yet. Create your first one, or import an existing nginx config, to get
          started.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((w) => (
            <Link key={w.id} to="/workspace/$id" params={{ id: w.id }} className="group">
              <Card className="h-full p-5 transition-all hover:border-primary/40 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <WorkflowIcon className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge status={w.status} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={`Delete ${w.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget({ id: w.id, name: w.name });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-base font-semibold">{w.name}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {w.description}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <span>v{w.version}</span>
                  <span>{w.nodes.length} nodes</span>
                  <span className="truncate max-w-[8rem]">{w.domains[0]}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Public API Edge"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this workflow fronts"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Import an existing nginx config</DialogTitle>
            <DialogDescription>
              Upload one or more .conf files (e.g. an Nginx Proxy Manager export — one workflow is
              created per file, named after the filename) or paste a single config below. Listener,
              Domain, SSL, Route, Backend, and GRPC nodes are reconstructed automatically from
              server/location blocks. upstream load balancing and stream (TCP/UDP) config aren't
              imported yet — add those nodes by hand afterward if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {importFiles.length > 0
                    ? `${importFiles.length} file(s) selected`
                    : "Config file(s)"}
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Choose file(s)
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".conf,.txt,text/plain"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesPicked(e.target.files)}
                />
              </div>
              {importFiles.length > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
                  {importFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        className="ml-2 shrink-0 hover:text-destructive"
                        onClick={() => setImportFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {importFiles.length === 0 && (
              <>
                <div className="space-y-2">
                  <Label>Workflow name</Label>
                  <Input
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    placeholder="e.g. Imported from NPM"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Or paste config contents</Label>
                  <Textarea
                    value={importConfig}
                    onChange={(e) => setImportConfig(e.target.value)}
                    placeholder="server { listen 80; server_name example.com; location / { proxy_pass http://127.0.0.1:8080; } }"
                    className="min-h-[220px] font-mono text-xs"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false);
                setImportFiles([]);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing
                ? "Importing..."
                : importFiles.length > 1
                  ? `Import ${importFiles.length} workflows`
                  : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workflow, its version history, and its deployed Nginx
              config (if any). This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirm();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
