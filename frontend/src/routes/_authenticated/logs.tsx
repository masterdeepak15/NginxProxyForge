import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { apiService } from "@/services/api";
import { formatLocalDateTime } from "@/lib/utils";

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

const PAGE_SIZE = 50;

const lvlColor: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  error: "text-red-500",
};

function LogsPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Debounce search input before it hits the server.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q);
      setPage(1); // reset to first page whenever the query changes
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      return apiService
        .getLogsPage({ page, pageSize: PAGE_SIZE, q: debouncedQ || undefined })
        .then((res) => {
          setLogs(res.data);
          setTotal(res.total);
        })
        .finally(() => setLoading(false));
    },
    [page, debouncedQ],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQ]);

  // Auto-refresh only while viewing the newest page with no active search —
  // otherwise a background refresh would yank the operator off the page
  // (and results) they're actively looking at.
  const isLive = page === 1 && !debouncedQ;
  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => load({ silent: true }), 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLive
              ? "Live tail, refreshes every 5s."
              : "Paused while browsing — showing this page's snapshot."}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter logs…"
          className="pl-9"
        />
      </div>
      <Card className="overflow-hidden">
        <div className="max-h-[560px] overflow-auto font-mono text-xs">
          {loading && <div className="p-4 text-muted-foreground">Loading…</div>}
          {!loading && logs.length === 0 && (
            <div className="p-4 text-muted-foreground">
              {debouncedQ
                ? "No log entries match your filter."
                : "No log entries yet — deploy a workflow to generate activity."}
            </div>
          )}
          {!loading &&
            logs.map((l, i) => (
              <div
                key={i}
                className="flex gap-3 border-b border-border/40 px-4 py-2 hover:bg-muted/40"
              >
                <span className="w-40 shrink-0 text-muted-foreground">
                  {formatLocalDateTime(l.ts)}
                </span>
                <span className={`w-12 uppercase shrink-0 ${lvlColor[l.level]}`}>{l.level}</span>
                <span className="w-40 shrink-0 truncate text-primary/80">
                  {l.workflowId ?? "system"}
                </span>
                <span className="text-foreground">{l.message}</span>
              </div>
            ))}
        </div>
      </Card>
      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
