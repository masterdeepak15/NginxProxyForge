import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

export interface AuthedRequest extends Request {
  userId?: string;
  userRole?: string;
}

export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: "12h" });
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res
      .status(401)
      .json({
        error: { code: "unauthorized", message: "Missing bearer token" },
      });
  }
  if (isRevoked(token)) {
    return res
      .status(401)
      .json({
        error: { code: "unauthorized", message: "Token has been revoked" },
      });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      role: string;
    };
    req.userId = payload.sub;
    req.userRole = payload.role;
    next();
  } catch {
    return res
      .status(401)
      .json({
        error: { code: "unauthorized", message: "Invalid or expired token" },
      });
  }
}

// Simple in-memory token blacklist for /auth/logout (tokens are short-lived JWTs).
const revoked = new Set<string>();
export function revokeToken(token: string) {
  revoked.add(token);
}
export function isRevoked(token: string) {
  return revoked.has(token);
}
