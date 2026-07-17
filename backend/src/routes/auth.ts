import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { signToken, requireAuth, revokeToken, type AuthedRequest } from "../middleware/auth";
import type { User } from "../types";

export const authRouter = Router();

function toUser(row: any): User {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

authRouter.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: { code: "bad_request", message: "email and password required" } });
  }
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: { code: "invalid_credentials", message: "Invalid email or password" } });
  }
  const token = signToken(row.id, row.role);
  res.json({ user: toUser(row), token, mustChangePassword: Boolean(row.must_change_password) });
});

authRouter.post("/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) revokeToken(token);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId ?? null) as any;
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "User not found" } });
  res.json(toUser(row));
});

authRouter.post("/change-password", requireAuth, (req: AuthedRequest, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res
      .status(422)
      .json({ error: { code: "validation", message: "Password must be at least 8 characters" } });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    hash,
    req.userId ?? null,
  );
  res.json({ ok: true });
});
