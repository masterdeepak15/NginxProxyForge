import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Workflow as WorkflowIcon,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { apiService, type MetricPoint } from "@/services/api";
import { useAppDispatch, useAppSelector } from "@/store";
import { fetchWorkflows } from "@/store/slices/workflowsSlice";
import { fetchDeployments } from "@/store/slices/deploymentsSlice";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · ProxyForge" },
      { name: "description", content: "Fleet overview of your Nginx workflows." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const dispatch = useAppDispatch();
  const workflows = useAppSelector((s) => s.workflows.items);
  const deployments = useAppSelector((s) => s.deployments.items);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof apiService.getStats>> | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [domainStats, setDomainStats] = useState<Awaited<
    ReturnType<typeof apiService.getDomainStats>
  > | null>(null);

  useEffect(() => {
    dispatch(fetchWorkflows());
    dispatch(fetchDeployments());
    apiService.getStats().then(setStats);
    apiService.getMetrics().then(setMetrics);
    apiService.getDomainStats().then(setDomainStats);
  }, [dispatch]);

  const kpis = [
    {
      label: "Workflows",
      value: stats?.totalWorkflows ?? "—",
      icon: WorkflowIcon,
      hint: `${stats?.deployed ?? 0} deployed`,
    },
    { label: "Domains", value: stats?.totalDomains ?? "—", icon: Globe, hint: "Across all edges" },
    {
      label: "Requests / sec",
      value: stats?.requestsPerSec.toLocaleString() ?? "—",
      icon: Activity,
      hint: "Live",
    },
    {
      label: "P95 Latency",
      value: stats ? `${stats.p95Latency} ms` : "—",
      icon: TrendingUp,
      hint: "Last 5 min",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fleet health across all Nginx workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stats?.drifted ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
              <ShieldAlert className="h-3.5 w-3.5" />
              {stats.drifted} workflow drifted
            </div>
          ) : null}
          {stats?.expiringCerts ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              {stats.expiringCerts} cert expiring
            </div>
          ) : null}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-5">
            <div className="flex items-start justify-between">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {k.label}
              </div>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-3 text-3xl font-semibold tracking-tight">{k.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{k.hint}</div>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Traffic</div>
              <div className="text-xs text-muted-foreground">Requests per hour · last 24h</div>
            </div>
            <div className="text-xs text-emerald-500 flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3" /> +12.4%
            </div>
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics}>
                <defs>
                  <linearGradient id="fill1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="var(--color-primary)"
                  fill="url(#fill1)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-medium">Latency (ms)</div>
          <div className="text-xs text-muted-foreground">P95 · last 24h</div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="latencyMs"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Domain requests */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-sm font-medium">Top domains by traffic</div>
          <div className="text-xs text-muted-foreground">Requests · last 24h</div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={domainStats?.topByRequests ?? []}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="domain"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="requests" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {domainStats && domainStats.topByRequests.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">No traffic recorded yet.</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="text-sm font-medium">Top domains by errors</div>
          <div className="text-xs text-muted-foreground">5xx responses · last 24h</div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={domainStats?.topByErrors ?? []}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="domain"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="errors" fill="var(--color-destructive)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {domainStats && domainStats.topByErrors.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">No errors in this window.</p>
          )}
        </Card>
      </div>

      {/* Recent workflows + deployments */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium">Workflows</div>
            <Link to="/workspace" className="text-xs text-primary hover:underline">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-border/60">
            {workflows.slice(0, 5).map((w) => (
              <Link
                key={w.id}
                to="/workspace/$id"
                params={{ id: w.id }}
                className="flex items-center justify-between py-3 hover:bg-muted/40 -mx-2 px-2 rounded"
              >
                <div>
                  <div className="text-sm font-medium">{w.name}</div>
                  <div className="text-xs text-muted-foreground">{w.domains.join(", ")}</div>
                </div>
                <StatusBadge status={w.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium">Recent deployments</div>
            <Link to="/deployments" className="text-xs text-primary hover:underline">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-border/60">
            {deployments.slice(0, 5).map((d) => (
              <div key={d.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2
                    className={
                      d.status === "success"
                        ? "h-4 w-4 text-emerald-500"
                        : "h-4 w-4 text-muted-foreground"
                    }
                  />
                  <div>
                    <div className="text-sm font-medium">
                      {d.workflowName} <span className="text-muted-foreground">v{d.version}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.author} · {new Date(d.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
