import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiService, type MetricPoint } from "@/services/api";
import { formatLocalTick, formatLocalDateTime } from "@/lib/utils";
import { Link } from "@tanstack/react-router";

type ErrorEntry = Awaited<ReturnType<typeof apiService.getRecentErrors>>["data"][number];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const LEVEL_STYLES: Record<string, string> = {
  crit: "bg-red-500/15 text-red-500",
  error: "bg-destructive/15 text-destructive",
  warn: "bg-amber-500/15 text-amber-500",
};

export const Route = createFileRoute("/_authenticated/metrics")({
  head: () => ({
    meta: [
      { title: "Metrics · ProxyForge" },
      { name: "description", content: "Live traffic and error metrics." },
    ],
  }),
  component: MetricsPage,
});

function MetricsPage() {
  const [data, setData] = useState<MetricPoint[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorsPage, setErrorsPage] = useState(1);
  const [errorsPageSize, setErrorsPageSize] = useState<number>(25);
  const [loadingErrors, setLoadingErrors] = useState(true);

  useEffect(() => {
    apiService.getMetrics().then(setData);
  }, []);

  const loadErrors = useCallback(() => {
    setLoadingErrors(true);
    return apiService
      .getRecentErrors("24h", { page: errorsPage, pageSize: errorsPageSize })
      .then((res) => {
        setErrors(res.data);
        setErrorsTotal(res.total);
      })
      .finally(() => setLoadingErrors(false));
  }, [errorsPage, errorsPageSize]);

  useEffect(() => {
    loadErrors();
  }, [loadErrors]);

  const errorsTotalPages = Math.max(1, Math.ceil(errorsTotal / errorsPageSize));

  const tt = {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Metrics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests, errors, and latency across your Nginx fleet.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-sm font-medium">Requests / hour</div>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatLocalTick}
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
                <Tooltip contentStyle={tt} labelFormatter={(v) => formatLocalDateTime(String(v))} />
                <Bar dataKey="requests" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-medium">Errors / hour</div>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatLocalTick}
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
                <Tooltip contentStyle={tt} labelFormatter={(v) => formatLocalDateTime(String(v))} />
                <Line
                  type="monotone"
                  dataKey="errors"
                  stroke="var(--color-destructive)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="lg:col-span-2 p-5">
          <div className="text-sm font-medium">Latency (P95, ms)</div>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatLocalTick}
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
                <Tooltip contentStyle={tt} labelFormatter={(v) => formatLocalDateTime(String(v))} />
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

      {/* Recent errors: what, where, from - not just a count */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Recent errors</div>
            <p className="text-xs text-muted-foreground">
              Parsed from each domain's nginx error log — latest {errorsTotal} of the last 24h (100
              max)
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows</span>
            <Select
              value={String(errorsPageSize)}
              onValueChange={(v) => {
                setErrorsPageSize(Number(v));
                setErrorsPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Time</th>
                <th className="pb-2 pr-4 font-medium">Level</th>
                <th className="pb-2 pr-4 font-medium">Domain</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {errors.map((e, i) => (
                <tr key={i} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-muted-foreground">
                    {formatLocalDateTime(e.time)}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${LEVEL_STYLES[e.level] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {e.level}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      to="/workspace/$id"
                      params={{ id: e.workflowId }}
                      className="text-primary hover:underline"
                    >
                      {e.domain}
                    </Link>
                    <div className="text-xs text-muted-foreground">{e.workflowName}</div>
                  </td>
                  <td className="py-2 pr-4 max-w-md">{e.type}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {e.upstream && <div>upstream: {e.upstream}</div>}
                    {e.client && <div>client: {e.client}</div>}
                    {e.request && <div className="truncate max-w-xs">{e.request}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadingErrors && (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {!loadingErrors && errors.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No errors logged in this window.
            </p>
          )}
        </div>
        {!loadingErrors && errorsTotal > 0 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {(errorsPage - 1) * errorsPageSize + 1}–
              {Math.min(errorsPage * errorsPageSize, errorsTotal)} of {errorsTotal}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={errorsPage <= 1}
                onClick={() => setErrorsPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </Button>
              <span>
                Page {errorsPage} of {errorsTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={errorsPage >= errorsTotalPages}
                onClick={() => setErrorsPage((p) => Math.min(errorsTotalPages, p + 1))}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
