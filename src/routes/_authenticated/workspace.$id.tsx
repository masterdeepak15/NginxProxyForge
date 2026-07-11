import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Play,
  History,
  Save,
  Server,
  Globe,
  Lock,
  Route as RouteIcon,
  Shield,
  Gauge,
  Database,
  Network,
  Cable,
  Layers,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useAppDispatch, useAppSelector } from "@/store";
import { fetchWorkflow } from "@/store/slices/workflowsSlice";
import type { NodeType, WorkflowNode } from "@/services/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/workspace/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Workflow ${params.id} · ProxyForge` },
      { name: "description", content: "Visual node editor for the selected workflow." },
    ],
  }),
  component: WorkflowEditor,
});

const nodeIcon: Record<NodeType, typeof Server> = {
  Listener: Server,
  Domain: Globe,
  SSL: Lock,
  Route: RouteIcon,
  Auth: Shield,
  RateLimit: Gauge,
  Cache: Layers,
  LB: Network,
  Backend: Database,
  TCP: Cable,
  UDP: Cable,
};

const paletteGroups: { label: string; items: NodeType[] }[] = [
  { label: "Entry", items: ["Listener", "Domain", "SSL"] },
  { label: "Routing", items: ["Route", "Auth", "RateLimit", "Cache"] },
  { label: "Upstream", items: ["LB", "Backend"] },
  { label: "L4", items: ["TCP", "UDP"] },
];

function WorkflowEditor() {
  const { id } = Route.useParams();
  const dispatch = useAppDispatch();
  const workflow = useAppSelector((s) => s.workflows.current);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchWorkflow(id));
  }, [dispatch, id]);

  if (!workflow || workflow.id !== id) {
    return (
      <div className="p-6">
        <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
      </div>
    );
  }

  const selectedNode = workflow.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border/60 bg-background px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/workspace">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold">{workflow.name}</h1>
              <StatusBadge status={workflow.status} />
              <span className="text-xs text-muted-foreground">v{workflow.version}</span>
            </div>
            <div className="text-xs text-muted-foreground">{workflow.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <History className="h-4 w-4" /> Versions
          </Button>
          <Button variant="outline" size="sm">
            <Save className="h-4 w-4" /> Save draft
          </Button>
          <Button size="sm">
            <Play className="h-4 w-4" /> Deploy
          </Button>
        </div>
      </div>

      {/* 3-pane workspace */}
      <div className="grid flex-1 grid-cols-[220px_1fr_280px] overflow-hidden">
        {/* Palette */}
        <aside className="overflow-y-auto border-r border-border/60 bg-card/30 p-3">
          <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Node palette
          </div>
          {paletteGroups.map((g) => (
            <div key={g.label} className="mb-4">
              <div className="mb-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {g.label}
              </div>
              <div className="space-y-1">
                {g.items.map((t) => {
                  const Icon = nodeIcon[t];
                  return (
                    <div
                      key={t}
                      className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border hover:bg-background"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {t}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* Canvas */}
        <div className="relative overflow-auto bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:20px_20px]">
          <div className="relative min-h-full min-w-[1100px]" style={{ height: 500 }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {workflow.edges.map((e) => {
                const from = workflow.nodes.find((n) => n.id === e.from);
                const to = workflow.nodes.find((n) => n.id === e.to);
                if (!from || !to) return null;
                const x1 = from.x + 160;
                const y1 = from.y + 32;
                const x2 = to.x;
                const y2 = to.y + 32;
                const dx = Math.abs(x2 - x1) * 0.5;
                const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
                return (
                  <path
                    key={e.id}
                    d={d}
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>
            {workflow.nodes.map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                active={selected === n.id}
                onClick={() => setSelected(n.id)}
              />
            ))}
          </div>
        </div>

        {/* Property panel */}
        <aside className="overflow-y-auto border-l border-border/60 bg-card/30 p-4">
          <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Properties
          </div>
          {selectedNode ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="text-sm font-medium">{selectedNode.type}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Label</div>
                <div className="text-sm font-medium">{selectedNode.label}</div>
              </div>
              <div className="border-t border-border/60 pt-4">
                <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Config
                </div>
                {Object.keys(selectedNode.properties).length === 0 && (
                  <div className="text-xs text-muted-foreground">No properties set.</div>
                )}
                {Object.entries(selectedNode.properties).map(([k, v]) => (
                  <div key={k} className="mb-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {k}
                    </div>
                    <div className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm font-mono">
                      {String(v)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              Select a node on the canvas to edit its properties.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  active,
  onClick,
}: {
  node: WorkflowNode;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = nodeIcon[node.type];
  return (
    <button
      onClick={onClick}
      style={{ left: node.x, top: node.y }}
      className={cn(
        "absolute w-40 rounded-lg border bg-card p-3 text-left shadow-sm transition-all",
        active
          ? "border-primary ring-2 ring-primary/30"
          : "border-border/60 hover:border-primary/50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {node.type}
        </div>
      </div>
      <div className="mt-2 truncate text-sm font-medium">{node.label}</div>
    </button>
  );
}
