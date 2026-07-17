import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import type { Workflow, WorkflowNode, WorkflowEdge } from "../types";
import { validateTopology } from "../lib/nodeRules";
import { generateNginxConfig } from "../lib/nginxGenerator";
import { deployWorkflow, rollbackDeployment } from "../nginx/deployPipeline";
import { removeWorkflowConf } from "../nginx/processManager";
import type { AuthedRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

function rowToWorkflow(row: any): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at,
    domains: JSON.parse(row.domains),
    nodes: JSON.parse(row.nodes),
    edges: JSON.parse(row.edges),
  };
}

function deriveDomains(nodes: WorkflowNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.type === "Domain") {
      const hosts = (n.properties.hostnames as string[]) || [];
      hosts.forEach((h) => out.add(h));
    }
  }
  return Array.from(out);
}

function snapshotVersion(wf: Workflow, author: string, message?: string) {
  db.prepare(
    `INSERT INTO versions (workflow_id, version, snapshot, author, message) VALUES (?,?,?,?,?)`,
  ).run(wf.id, wf.version, JSON.stringify(wf), author, message || null);
}

workflowsRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all();
  res.json(rows.map(rowToWorkflow));
});

workflowsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Workflow not found" } });
  res.json(rowToWorkflow(row));
});

workflowsRouter.post("/", (req: AuthedRequest, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: { code: "bad_request", message: "name is required" } });
  const wf: Workflow = {
    id: `wf_${randomUUID().slice(0, 8)}`,
    name,
    description: description || "",
    status: "draft",
    version: 1,
    updatedAt: new Date().toISOString(),
    domains: [],
    nodes: [],
    edges: [],
  };
  db.prepare(
    `INSERT INTO workflows (id, name, description, status, version, updated_at, domains, nodes, edges)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(wf.id, wf.name, wf.description, wf.status, wf.version, wf.updatedAt, "[]", "[]", "[]");
  snapshotVersion(wf, req.userId || "system", "Created");
  res.status(201).json(wf);
});

workflowsRouter.patch("/:id", (req: AuthedRequest, res) => {
  const existingRow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
  if (!existingRow) return res.status(404).json({ error: { code: "not_found", message: "Workflow not found" } });
  const existing = rowToWorkflow(existingRow);

  const patch = req.body || {};
  const nodes: WorkflowNode[] = patch.nodes ?? existing.nodes;
  const edges: WorkflowEdge[] = patch.edges ?? existing.edges;
  const updated: Workflow = {
    ...existing,
    ...patch,
    nodes,
    edges,
    domains: deriveDomains(nodes),
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
    status: existing.status === "deployed" ? "drifted" : existing.status,
  };

  db.prepare(
    `UPDATE workflows SET name=?, description=?, status=?, version=?, updated_at=?, domains=?, nodes=?, edges=? WHERE id=?`,
  ).run(
    updated.name,
    updated.description,
    updated.status,
    updated.version,
    updated.updatedAt,
    JSON.stringify(updated.domains),
    JSON.stringify(updated.nodes),
    JSON.stringify(updated.edges),
    updated.id,
  );
  snapshotVersion(updated, req.userId || "system", patch.message || "Save");
  res.json(updated);
});

workflowsRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Workflow not found" } });
  db.prepare("DELETE FROM workflows WHERE id = ?").run(req.params.id);
  removeWorkflowConf(req.params.id);
  res.status(204).end();
});

workflowsRouter.post("/:id/validate", (req, res) => {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Workflow not found" } });
  const wf = rowToWorkflow(row);
  const errors = validateTopology(wf);
  res.json({ ok: errors.length === 0, errors });
});

workflowsRouter.post("/:id/compile", (req, res) => {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Workflow not found" } });
  const wf = rowToWorkflow(row);
  res.json({ config: generateNginxConfig(wf) });
});

workflowsRouter.get("/:id/versions", (req, res) => {
  const rows = db
    .prepare("SELECT version, updated_at as updatedAt, author, message FROM versions WHERE workflow_id = ? ORDER BY version DESC")
    .all(req.params.id);
  res.json(rows);
});

workflowsRouter.post("/:id/rollback", (req: AuthedRequest, res) => {
  const { toVersion } = req.body || {};
  const versionRow = db
    .prepare("SELECT * FROM versions WHERE workflow_id = ? AND version = ?")
    .get(req.params.id, toVersion) as any;
  if (!versionRow) return res.status(404).json({ error: { code: "not_found", message: "Version not found" } });
  const snapshot: Workflow = JSON.parse(versionRow.snapshot);
  const restored: Workflow = {
    ...snapshot,
    version: (db.prepare("SELECT MAX(version) as v FROM versions WHERE workflow_id = ?").get(req.params.id) as any).v + 1,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `UPDATE workflows SET name=?, description=?, status=?, version=?, updated_at=?, domains=?, nodes=?, edges=? WHERE id=?`,
  ).run(
    restored.name,
    restored.description,
    "drifted",
    restored.version,
    restored.updatedAt,
    JSON.stringify(restored.domains),
    JSON.stringify(restored.nodes),
    JSON.stringify(restored.edges),
    restored.id,
  );
  snapshotVersion({ ...restored, status: "drifted" }, req.userId || "system", `Rollback to v${toVersion}`);
  res.json(restored);
});

workflowsRouter.post("/:id/deploy", async (req: AuthedRequest, res) => {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "Workflow not found" } });
  const wf = rowToWorkflow(row);
  const errors = validateTopology(wf);
  if (errors.length) {
    return res.status(422).json({ error: { code: "invalid_topology", message: "Workflow has topology errors", details: errors } });
  }
  const author = (db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId ?? null) as any)?.name || "system";
  const deployment = await deployWorkflow(wf, author);
  res.status(202).json(deployment);
});
