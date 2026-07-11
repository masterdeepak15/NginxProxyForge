import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Logs · ProxyForge" },
      { name: "description", content: "Streaming log tail scoped to workflows and nodes." },
    ],
  }),
  component: LogsPage,
});

const sample = [
  { t: "12:04:22.881", lvl: "info", src: "wf_edge_api/Route", msg: "GET /v1/users 200 42ms" },
  { t: "12:04:22.877", lvl: "info", src: "wf_edge_api/Backend", msg: "upstream api-service:8080 responded in 38ms" },
  { t: "12:04:22.412", lvl: "warn", src: "wf_edge_api/RateLimit", msg: "client 203.0.113.9 throttled (52 rps)" },
  { t: "12:04:20.115", lvl: "error", src: "wf_db_proxy/TCP", msg: "connect ECONNREFUSED pg-primary:5432" },
  { t: "12:04:19.902", lvl: "info", src: "wf_marketing/Cache", msg: "HIT /about (age=182s)" },
  { t: "12:04:19.310", lvl: "info", src: "wf_admin/Auth", msg: "IP 10.0.0.15 allowed" },
  { t: "12:04:18.774", lvl: "warn", src: "wf_edge_api/SSL", msg: "cert api.example.com expires in 55d" },
];

const lvlColor: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  error: "text-red-500",
};

function LogsPage() {
  const [q, setQ] = useState("");
  const filtered = sample.filter((l) => (l.src + l.msg).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Streaming tail scoped to workflow and node.
        </p>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter logs…" className="pl-9" />
      </div>
      <Card className="overflow-hidden">
        <div className="max-h-[560px] overflow-auto font-mono text-xs">
          {filtered.map((l, i) => (
            <div
              key={i}
              className="flex gap-3 border-b border-border/40 px-4 py-2 hover:bg-muted/40"
            >
              <span className="text-muted-foreground shrink-0">{l.t}</span>
              <span className={`w-12 uppercase shrink-0 ${lvlColor[l.lvl]}`}>{l.lvl}</span>
              <span className="w-56 shrink-0 text-primary/80">{l.src}</span>
              <span className="text-foreground">{l.msg}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
