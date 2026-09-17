import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, businessesTable, usersTable, usageTable } from "@workspace/db";

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
    const businessId = `business_${userId}`;
    const [business] = await db
      .insert(businessesTable)
      .values({
        id: businessId,
        name: "New LeadSprint workspace",
        market: "US",
        timezone: "America/New_York",
        phoneNumber: "",
        transferNumber: "",
        projectName: "Configure your first campaign",
        approvedFaq: "",
        qualificationQuestions: [],
        escalationRules:
          "Transfer questions outside approved business information to a human.",
      })
      .onConflictDoNothing()
      .returning();

    if (!business) {
      [user] = await db
        .select()
        .from(usersTable)
        .where(and(eq(usersTable.id, userId), eq(usersTable.businessId, businessId)))
        .limit(1);
    } else {
      [user] = await db
        .insert(usersTable)
        .values({
          id: userId,
          businessId,
          name,
          email,
          role: "owner",
          lastLoginAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      const now = new Date();
      const usageRowId = `usage_${businessId}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      await db
        .insert(usageTable)
        .values({
          id: usageRowId,
          businessId,
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
        })
        .onConflictDoNothing();
    }
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