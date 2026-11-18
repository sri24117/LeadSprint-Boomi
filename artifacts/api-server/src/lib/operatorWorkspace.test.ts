import { beforeEach, describe, expect, it } from "vitest";
import { businessesTable, usersTable, usageTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import { provisionOperatorWorkspace } from "./operatorWorkspace";

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
const identity = { userId: "user_new", name: "New owner", email: "owner@example.com" };
const provision = () => provisionOperatorWorkspace(identity, db as never);

describe("operator workspace provisioning", () => {
  it("creates an owner, business and usage row and is safe to retry", async () => {
    const owner = await provision();
    expect(owner.businessId).toBe("business_user_new");
    expect(owner.role).toBe("owner");
    await provision();
    expect(await db.select().from(businessesTable)).toHaveLength(1);
    expect(await db.select().from(usersTable)).toHaveLength(1);
    expect(await db.select().from(usageTable)).toHaveLength(1);
  });

  it("repairs a business orphaned by a previous partial signup without overwriting settings", async () => {
    await db.insert(businessesTable).values(pilotBusiness({ id: "business_user_new", name: "Existing customer" }));
    await provision();
    expect((await db.select().from(businessesTable))[0].name).toBe("Existing customer");
    expect(await db.select().from(usersTable)).toHaveLength(1);
    expect(await db.select().from(usageTable)).toHaveLength(1);
  });

  it("rolls back all new records when owner provisioning fails", async () => {
    await expect(provisionOperatorWorkspace({ ...identity, email: null as never }, db as never)).rejects.toThrow();
    expect(await db.select().from(businessesTable)).toHaveLength(0);
    expect(await db.select().from(usersTable)).toHaveLength(0);
    expect(await db.select().from(usageTable)).toHaveLength(0);
    expect((await provision()).id).toBe(identity.userId);
  });

  it("does not move an existing user into another workspace", async () => {
    await db.insert(businessesTable).values(pilotBusiness());
    await db.insert(usersTable).values({ id: identity.userId, businessId: "business_pilot", name: "Invited", email: identity.email });
    await expect(provision()).rejects.toThrow("could not be provisioned");
    expect(await db.select().from(businessesTable)).toHaveLength(1);
    expect((await db.select().from(usersTable))[0].businessId).toBe("business_pilot");
  });
});
