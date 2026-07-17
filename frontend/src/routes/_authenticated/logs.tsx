import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, RefreshCw } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { apiService } from "@/services/api";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Logs · ProxyForge" },
      { name: "description", content: "Streaming log tail scoped to workflows and nodes." },
    ],
  }),
  component: LogsPage,
});

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  workflowId?: string;
  message: string;
}

const lvlColor: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  error: "text-red-500",
};

function LogsPage() {
  const [q, setQ] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    apiService
      .getLogs({ limit: 200 })
      .then(setLogs)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const filtered = logs.filter((l) =>
    (( l.workflowId ?? "") + l.message).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Streaming tail scoped to workflow and node. Refreshes every 5s.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter logs…" className="pl-9" />
      </div>
      <Card className="overflow-hidden">
        <div className="max-h-[560px] overflow-auto font-mono text-xs">
          {loading && <div className="p-4 text-muted-foreground">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-4 text-muted-foreground">
              No log entries yet — deploy a workflow to generate activity.
            </div>
          )}
          {filtered.map((l, i) => (
            <div
              key={i}
              className="flex gap-3 border-b border-border/40 px-4 py-2 hover:bg-muted/40"
            >
              <span className="text-muted-foreground shrink-0">
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              <span className={`w-12 uppercase shrink-0 ${lvlColor[l.level]}`}>{l.level}</span>
              <span className="w-40 shrink-0 truncate text-primary/80">{l.workflowId ?? "system"}</span>
              <span className="text-foreground">{l.message}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
