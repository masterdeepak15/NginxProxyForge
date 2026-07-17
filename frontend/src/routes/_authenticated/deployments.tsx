import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { useAppDispatch, useAppSelector } from "@/store";
import { fetchDeployments } from "@/store/slices/deploymentsSlice";

export const Route = createFileRoute("/_authenticated/deployments")({
  head: () => ({
    meta: [
      { title: "Deployments · ProxyForge" },
      { name: "description", content: "Deployment history across all workflows." },
    ],
  }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.deployments.items);

  useEffect(() => {
    if (items.length === 0) dispatch(fetchDeployments());
  }, [dispatch, items.length]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every deploy is validated with <code className="rounded bg-muted px-1 py-0.5 text-xs">nginx -t</code> and reversible.
        </p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workflow</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.workflowName}</TableCell>
                <TableCell className="text-muted-foreground">v{d.version}</TableCell>
                <TableCell>
                  <StatusBadge status={d.status} />
                </TableCell>
                <TableCell>{d.author}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(d.durationMs / 1000).toFixed(1)}s
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(d.timestamp).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
