import { db } from "./db";

export type LogLevel = "info" | "warn" | "error";

export function addLog(level: LogLevel, workflowId: string | null, message: string) {
  db.prepare(`INSERT INTO log_entries (level, workflow_id, message) VALUES (?,?,?)`).run(
    level,
    workflowId,
    message,
  );
}
