import { randomUUID } from "crypto";
import { db } from "../db";
import type { Workflow, Deployment } from "../types";
import { generateNginxFragments } from "../lib/nginxGenerator";
import {
  writeStaging,
  validateConfig,
  backupConfDir,
  restoreConfDir,
  reloadNginx,
  healthCheck,
} from "./processManager";
import { addLog } from "../logs";

function firstListenerPort(wf: Workflow): number | null {
  const listener = wf.nodes.find((n) => n.type === "Listener");
  if (!listener) return null;
  const port = listener.properties.port;
  return typeof port === "number" ? port : null;
}

export async function deployWorkflow(workflow: Workflow, author: string): Promise<Deployment> {
  const started = Date.now();
  const id = `d_${randomUUID().slice(0, 8)}`;
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
    addLog("info", workflow.id, msg);
  };

  log(`Generating nginx config for workflow "${workflow.name}" v${workflow.version}`);
  const fragments = generateNginxFragments(workflow);
  if (!fragments.http && !fragments.stream) {
    log("Workflow has no Listener/TCP/UDP entrypoint — nothing to deploy");
    const dep = finalize(id, workflow, "failed", author, started, logs);
    db.prepare("UPDATE workflows SET status = 'failed' WHERE id = ?").run(workflow.id);
    return dep;
  }
  const staging = writeStaging(workflow.id, fragments);

  log("Validating with nginx -t");
  const validation = validateConfig(workflow.id, staging);
  if (!validation.ok) {
    log(`Validation failed: ${validation.output}`);
    const dep = finalize(id, workflow, "failed", author, started, logs);
    db.prepare("UPDATE workflows SET status = 'failed' WHERE id = ?").run(workflow.id);
    return dep;
  }
  log("Validation passed");

  log("Backing up current config");
  const backupDir = backupConfDir();

  log("Reloading nginx");
  const reload = reloadNginx();
  if (!reload.ok) {
    log(`Reload failed, restoring backup: ${reload.output}`);
    restoreConfDir(backupDir);
    reloadNginx();
    const dep = finalize(id, workflow, "failed", author, started, logs);
    db.prepare("UPDATE workflows SET status = 'failed' WHERE id = ?").run(workflow.id);
    return dep;
  }

  const port = firstListenerPort(workflow);
  if (port) {
    log(`Health-checking listener on port ${port}`);
    const healthy = await healthCheck(port);
    if (!healthy) {
      log("Health check failed — automatic rollback");
      restoreConfDir(backupDir);
      reloadNginx();
      const dep = finalize(id, workflow, "rolled_back", author, started, logs);
      db.prepare("UPDATE workflows SET status = 'failed' WHERE id = ?").run(workflow.id);
      return dep;
    }
    log("Health check passed");
  } else {
    log("No HTTP listener to health-check (stream-only workflow); skipping");
  }

  log("Deployment successful");
  const dep = finalize(id, workflow, "success", author, started, logs);
  db.prepare("UPDATE workflows SET status = 'deployed' WHERE id = ?").run(workflow.id);
  return dep;
}

function finalize(
  id: string,
  workflow: Workflow,
  status: Deployment["status"],
  author: string,
  started: number,
  logs: string[],
): Deployment {
  const durationMs = Date.now() - started;
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO deployments (id, workflow_id, workflow_name, version, status, author, timestamp, duration_ms, logs)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, workflow.id, workflow.name, workflow.version, status, author, timestamp, durationMs, JSON.stringify(logs));
  return {
    id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    version: workflow.version,
    status,
    author,
    timestamp,
    durationMs,
    logs,
  };
}

export async function rollbackDeployment(deploymentId: string, author: string): Promise<Deployment | null> {
  const row = db.prepare("SELECT * FROM deployments WHERE id = ?").get(deploymentId) as any;
  if (!row) return null;
  const versionRow = db
    .prepare("SELECT * FROM versions WHERE workflow_id = ? AND version = ?")
    .get(row.workflow_id, row.version) as any;
  if (!versionRow) return null;
  const snapshot: Workflow = JSON.parse(versionRow.snapshot);
  return deployWorkflow(snapshot, author);
}
