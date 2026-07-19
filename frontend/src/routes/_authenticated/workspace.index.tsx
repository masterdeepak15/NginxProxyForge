import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, Search, Workflow as WorkflowIcon, Upload } from "lucide-react";
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
import { StatusBadge } from "@/components/StatusBadge";
import { useAppDispatch, useAppSelector } from "@/store";
import { fetchWorkflows, createWorkflowThunk } from "@/store/slices/workflowsSlice";
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
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFilePicked = async (file: File) => {
    const text = await file.text();
    setImportConfig(text);
    if (!importName.trim()) setImportName(file.name.replace(/\.conf$/i, ""));
  };

  const handleImport = async () => {
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
      const { workflow, warnings } = await apiService.importWorkflow(importName.trim(), importConfig);
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
          No workflows yet. Create your first one, or import an existing nginx config, to get started.
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
                  <StatusBadge status={w.status} />
                </div>
                <div className="mt-4">
                  <div className="text-base font-semibold">{w.name}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{w.description}</div>
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
              Upload or paste a .conf file (e.g. an Nginx Proxy Manager export, or a hand-written config).
              Listener, Domain, SSL, Route, and Backend nodes are reconstructed automatically from
              server/location blocks. upstream load balancing and stream (TCP/UDP)
              config aren't imported yet - add those nodes by hand afterward if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Workflow name</Label>
              <Input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="e.g. Imported from NPM"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Config file contents</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> Choose file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".conf,.txt,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFilePicked(file);
                  }}
                />
              </div>
              <Textarea
                value={importConfig}
                onChange={(e) => setImportConfig(e.target.value)}
                placeholder="server { listen 80; server_name example.com; location / { proxy_pass http://127.0.0.1:8080; } }"
                className="min-h-[220px] font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
