import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { PointerEvent as RPointerEvent, DragEvent as RDragEvent } from "react";
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
  Radio,
  Layers,
  AlertTriangle,
  FileCode,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  fetchWorkflow,
  addNode,
  moveNode,
  addEdge,
  deleteEdge,
  deleteNode,
  updateNodeProperties,
  updateNodeLabel,
} from "@/store/slices/workflowsSlice";
import type { NodeType, WorkflowNode } from "@/services/api";
import { validateNode } from "@/lib/nodeSchemas";
import { canConnect, computeLabel, domainIsHttps } from "@/lib/nodeRules";
import { PropertyPanel } from "@/components/workspace/PropertyPanel";
import { NginxPreviewDialog } from "@/components/workspace/NginxPreviewDialog";
import { cn } from "@/lib/utils";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/workspace/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Workflow ${params.id} · ProxyForge` },
      { name: "description", content: "Visual node editor that compiles to nginx.conf." },
    ],
  }),
  component: WorkflowEditor,
});

const NODE_W = 176;
const NODE_H = 64;
const HANDLE_R = 6;

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
  { label: "L4 Stream", items: ["TCP", "UDP"] },
];

interface Pending {
  fromId: string;
  x: number;
  y: number;
}

function WorkflowEditor() {
  const { id } = Route.useParams();
  const dispatch = useAppDispatch();
  const workflow = useAppSelector((s) => s.workflows.current);

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  useEffect(() => {
    dispatch(fetchWorkflow(id));
  }, [dispatch, id]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / scale,
        y: (clientY - rect.top - pan.y) / scale,
      };
    },
    [pan, scale],
  );

  // Node move
  const onNodePointerDown = (e: RPointerEvent<HTMLDivElement>, n: WorkflowNode) => {
    if ((e.target as HTMLElement).closest("[data-handle]")) return;
    if ((e.target as HTMLElement).closest("input, textarea, button")) return;
    e.stopPropagation();
    setSelectedNode(n.id);
    setSelectedEdge(null);
    const world = toWorld(e.clientX, e.clientY);
    dragRef.current = { id: n.id, offX: world.x - n.x, offY: world.y - n.y };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const world = toWorld(e.clientX, e.clientY);
    dispatch(
      moveNode({
        id: dragRef.current.id,
        x: Math.round(world.x - dragRef.current.offX),
        y: Math.round(world.y - dragRef.current.offY),
      }),
    );
  };

  const onNodePointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
  };

  // Connection drag
  const onOutputPointerDown = (e: RPointerEvent<HTMLDivElement>, n: WorkflowNode) => {
    e.stopPropagation();
    const world = toWorld(e.clientX, e.clientY);
    setPending({ fromId: n.id, x: world.x, y: world.y });
  };

  const onViewportPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (pending) {
      const world = toWorld(e.clientX, e.clientY);
      setPending({ ...pending, x: world.x, y: world.y });
    }
    if (panRef.current) {
      setPan({
        x: panRef.current.panX + (e.clientX - panRef.current.startX),
        y: panRef.current.panY + (e.clientY - panRef.current.startY),
      });
    }
  };

  const onViewportPointerUp = () => {
    setPending(null);
    panRef.current = null;
  };

  const onInputPointerUp = (e: RPointerEvent<HTMLDivElement>, n: WorkflowNode) => {
    if (!pending) return;
    e.stopPropagation();
    const from = workflow?.nodes.find((x) => x.id === pending.fromId);
    if (from && !canConnect(from.type, n.type)) {
      setConnectError(`${from.type} → ${n.type} is not allowed.`);
      setTimeout(() => setConnectError(null), 2500);
      setPending(null);
      return;
    }
    dispatch(addEdge({ from: pending.fromId, to: n.id }));
    setPending(null);
  };

  // Pan
  const onViewportPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const isBg = e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBg;
    if (e.button === 1 || e.shiftKey || (isBg && e.button === 0)) {
      panRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      if (isBg) {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
      e.preventDefault();
    }
  };

  // Zoom
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const delta = -e.deltaY * 0.001;
    const next = Math.min(2, Math.max(0.4, scale + delta));
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Keep the point under cursor fixed
    setPan({
      x: mx - ((mx - pan.x) * next) / scale,
      y: my - ((my - pan.y) * next) / scale,
    });
    setScale(next);
  };

  // Drop from palette
  const onDrop = (e: RDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-node") as NodeType;
    if (!type) return;
    const world = toWorld(e.clientX, e.clientY);
    dispatch(addNode({ type, x: Math.round(world.x - NODE_W / 2), y: Math.round(world.y - NODE_H / 2) }));
  };

  // Keyboard delete
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        if (selectedNode) {
          dispatch(deleteNode(selectedNode));
          setSelectedNode(null);
        } else if (selectedEdge) {
          dispatch(deleteEdge(selectedEdge));
          setSelectedEdge(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch, selectedNode, selectedEdge]);

  const nodeErrors = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!workflow) return map;
    for (const n of workflow.nodes) {
      const r = validateNode(n.type, n.properties);
      if (!r.ok) map[n.id] = true;
    }
    return map;
  }, [workflow]);

  const hasErrors = Object.keys(nodeErrors).length > 0;
  const selected = workflow?.nodes.find((n) => n.id === selectedNode) ?? null;

  if (!workflow || workflow.id !== id) {
    return (
      <div className="p-6">
        <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
      </div>
    );
  }

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
              {hasErrors && (
                <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                  <AlertTriangle className="h-3 w-3" /> {Object.keys(nodeErrors).length} errors
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{workflow.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <FileCode className="h-4 w-4" /> View nginx.conf
          </Button>
          <Button variant="outline" size="sm">
            <History className="h-4 w-4" /> Versions
          </Button>
          <Button variant="outline" size="sm">
            <Save className="h-4 w-4" /> Save draft
          </Button>
          <Button size="sm" disabled={hasErrors}>
            <Play className="h-4 w-4" /> Deploy
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPanelOpen((v) => !v)} title={panelOpen ? "Hide properties" : "Show properties"}>
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* 3-pane workspace */}
      <div className={cn("grid flex-1 overflow-hidden", panelOpen ? "grid-cols-[220px_1fr_320px]" : "grid-cols-[220px_1fr]")}>

        {/* Palette */}
        <aside className="overflow-y-auto border-r border-border/60 bg-card/30 p-3">
          <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Node palette
          </div>
          <p className="mb-3 px-2 text-[10px] text-muted-foreground/80">
            Drag onto the canvas. Connect nodes by dragging from a right dot to a left dot.
          </p>
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
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-node", t);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border hover:bg-background active:cursor-grabbing"
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

        {/* Canvas viewport */}
        <div
          ref={viewportRef}
          className="relative overflow-hidden bg-background"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onWheel={onWheel}
        >
          {/* Zoom / fit controls */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border/60 bg-card/95 p-1 shadow-sm backdrop-blur">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setScale((s) => Math.max(0.4, s - 0.1))}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <div className="w-10 text-center text-[10px] font-mono text-muted-foreground">
              {Math.round(scale * 100)}%
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setScale((s) => Math.min(2, s + 0.1))}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setScale(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Hint */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-card/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
            Drag empty canvas to pan · Ctrl/⌘+wheel to zoom · Del to remove
          </div>
          {connectError && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              {connectError}
            </div>
          )}

          {/* World (pan/zoom transformed) */}
          <div
            data-canvas-bg
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: "0 0",
              backgroundImage:
                "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
              width: "4000px",
              height: "3000px",
            }}
          >
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={4000}
              height={3000}
            >
              {workflow.edges.map((e) => {
                const from = workflow.nodes.find((n) => n.id === e.from);
                const to = workflow.nodes.find((n) => n.id === e.to);
                if (!from || !to) return null;
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_H / 2;
                const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
                const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
                const active = selectedEdge === e.id;
                return (
                  <path
                    key={e.id}
                    d={d}
                    fill="none"
                    stroke={active ? "var(--color-destructive)" : "var(--color-primary)"}
                    strokeOpacity={active ? 0.9 : 0.6}
                    strokeWidth={active ? 2.5 : 1.8}
                    className="pointer-events-auto cursor-pointer"
                    style={{ pointerEvents: "stroke" }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdge(e.id);
                      setSelectedNode(null);
                    }}
                  />
                );
              })}
              {pending &&
                (() => {
                  const from = workflow.nodes.find((n) => n.id === pending.fromId);
                  if (!from) return null;
                  const x1 = from.x + NODE_W;
                  const y1 = from.y + NODE_H / 2;
                  const dx = Math.max(40, Math.abs(pending.x - x1) * 0.5);
                  const d = `M${x1},${y1} C${x1 + dx},${y1} ${pending.x - dx},${pending.y} ${pending.x},${pending.y}`;
                  return (
                    <path
                      d={d}
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth={1.8}
                      strokeDasharray="4 4"
                    />
                  );
                })()}
            </svg>

            {workflow.nodes.map((n) => {
              const Icon = nodeIcon[n.type];
              const active = selectedNode === n.id;
              const invalid = nodeErrors[n.id];
              return (
                <div
                  key={n.id}
                  style={{ left: n.x, top: n.y, width: NODE_W }}
                  className={cn(
                    "absolute select-none rounded-lg border bg-card shadow-sm transition-shadow",
                    active
                      ? "border-primary ring-2 ring-primary/30"
                      : invalid
                        ? "border-destructive/60"
                        : "border-border/60 hover:border-primary/50",
                  )}
                  onPointerDown={(e) => onNodePointerDown(e, n)}
                  onPointerMove={onNodePointerMove}
                  onPointerUp={onNodePointerUp}
                >
                  <div className="cursor-grab p-3 active:cursor-grabbing">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {n.type}
                      </div>
                      {invalid && (
                        <AlertTriangle className="ml-auto h-3.5 w-3.5 text-destructive" />
                      )}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">{computeLabel(n)}</div>
                    {n.type === "Domain" && domainIsHttps(workflow, n.id) && (
                      <div className="mt-1 text-[10px] text-primary/80">↳ SSL connectable</div>
                    )}
                  </div>

                  {/* Input handle */}
                  <div
                    data-handle="in"
                    onPointerUp={(e) => onInputPointerUp(e, n)}
                    style={{
                      left: -HANDLE_R,
                      top: NODE_H / 2 - HANDLE_R,
                      width: HANDLE_R * 2,
                      height: HANDLE_R * 2,
                    }}
                    className="absolute z-10 rounded-full border-2 border-primary bg-background hover:scale-125 hover:bg-primary"
                  />

                  {/* Output handle */}
                  <div
                    data-handle="out"
                    onPointerDown={(e) => onOutputPointerDown(e, n)}
                    style={{
                      left: NODE_W - HANDLE_R,
                      top: NODE_H / 2 - HANDLE_R,
                      width: HANDLE_R * 2,
                      height: HANDLE_R * 2,
                    }}
                    className="absolute z-10 cursor-crosshair rounded-full border-2 border-primary bg-primary hover:scale-125"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Property panel */}
        <aside className="overflow-y-auto border-l border-border/60 bg-card/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Properties
            </div>
            {selectedEdge && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive"
                onClick={() => {
                  dispatch(deleteEdge(selectedEdge));
                  setSelectedEdge(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove edge
              </Button>
            )}
          </div>
          <PropertyPanel
            node={selected}
            onChangeLabel={(label) =>
              selected && dispatch(updateNodeLabel({ id: selected.id, label }))
            }
            onChangeProps={(props) =>
              selected && dispatch(updateNodeProperties({ id: selected.id, properties: props }))
            }
            onDelete={() => {
              if (!selected) return;
              dispatch(deleteNode(selected.id));
              setSelectedNode(null);
            }}
          />
        </aside>
      </div>

      <NginxPreviewDialog
        workflow={workflow}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
