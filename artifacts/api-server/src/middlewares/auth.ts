import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { provisionOperatorWorkspace } from "../lib/operatorWorkspace";

declare global {
  namespace Express {
    interface Request {
      leadSprintUserId?: string;
      leadSprintBusinessId?: string;
    }
  }
}

function claimString(
  claims: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = claims?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId =
    auth?.userId ??
    claimString(auth?.sessionClaims ?? undefined, "userId");
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const claims = auth.sessionClaims as Record<string, unknown> | undefined;
  const email =
    claimString(claims, "email") ??
    claimString(claims, "email_address") ??
    `${userId}@clerk.local`;
  const name =
    claimString(claims, "name") ??
    claimString(claims, "given_name") ??
    email.split("@")[0] ??
    "Operator";

  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    user = await provisionOperatorWorkspace({ userId, name, email });
  } else {
    [user] = await db
      .update(usersTable)
      .set({ lastLoginAt: new Date(), name, email })
      .where(eq(usersTable.id, userId))
      .returning();
  }

  if (!user) {
    res.status(503).json({ error: "Operator workspace is not ready" });
    return;
  }

  req.leadSprintUserId = user.id;
  req.leadSprintBusinessId = user.businessId;
  next();
}