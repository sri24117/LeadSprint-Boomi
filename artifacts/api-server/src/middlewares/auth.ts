import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, businessesTable, usersTable, usageTable } from "@workspace/db";
import { getActiveUsageRow } from "../lib/usage";

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

  let user: typeof usersTable.$inferSelect | undefined;

  try {
    await db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (existingUser) {
        const [updated] = await tx
          .update(usersTable)
          .set({ lastLoginAt: new Date(), name, email })
          .where(eq(usersTable.id, userId))
          .returning();
        user = updated ?? existingUser;
        return;
      }

      const businessId = `business_${userId}`;

      let [business] = await tx
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, businessId))
        .limit(1);

      if (!business) {
        const [insertedBusiness] = await tx
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

        business = insertedBusiness;

        if (!business) {
          const [reFetched] = await tx
            .select()
            .from(businessesTable)
            .where(eq(businessesTable.id, businessId))
            .limit(1);
          business = reFetched;
        }
      }

      if (!business) {
        throw new Error(`Failed to provision business workspace for ${userId}`);
      }

      const [insertedUser] = await tx
        .insert(usersTable)
        .values({
          id: userId,
          businessId: business.id,
          name,
          email,
          role: "owner",
          lastLoginAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      if (insertedUser) {
        user = insertedUser;
      } else {
        const [reFetchedUser] = await tx
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        user = reFetchedUser;
      }

      const now = new Date();
      await getActiveUsageRow(business.id, now, tx);
    });
  } catch (err) {
    req.log?.error({ err }, "Error provisioning user workspace in requireAuth");
  }

  if (!user) {
    res.status(503).json({ error: "Operator workspace is not ready" });
    return;
  }

  req.leadSprintUserId = user.id;
  req.leadSprintBusinessId = user.businessId;
  next();
}