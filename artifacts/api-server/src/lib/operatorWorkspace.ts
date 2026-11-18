import { and, eq } from "drizzle-orm";
import { db, businessesTable, usersTable, usageTable } from "@workspace/db";

/** Atomic and recoverable provisioning, including deployments that previously
 * created a business but failed before creating its owner. Safe to retry.
 */
export async function provisionOperatorWorkspace(
  identity: { userId: string; name: string; email: string },
  handle: typeof db = db,
) {
  const { userId, name, email } = identity;
  const businessId = `business_${userId}`;
  return handle.transaction(async (tx) => {
    await tx.insert(businessesTable).values({
      id: businessId,
      name: "New LeadSprint workspace",
      market: "US",
      timezone: "America/New_York",
      phoneNumber: "",
      transferNumber: "",
      projectName: "Configure your first campaign",
      approvedFaq: "",
      qualificationQuestions: [],
      escalationRules: "Transfer questions outside approved business information to a human.",
    }).onConflictDoNothing();

    await tx.insert(usersTable).values({
      id: userId, businessId, name, email, role: "owner", lastLoginAt: new Date(),
    }).onConflictDoNothing();
    const [user] = await tx.select().from(usersTable).where(
      and(eq(usersTable.id, userId), eq(usersTable.businessId, businessId)),
    ).limit(1);
    if (!user) throw new Error("Operator workspace owner could not be provisioned");

    const now = new Date();
    await tx.insert(usageTable).values({
      id: `usage_${businessId}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      businessId,
      periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
      periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
    }).onConflictDoNothing();
    return user;
  });
}
