/**
 * Seed script for demo accounts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run seed
 *
 * Safe to run multiple times — uses ON CONFLICT DO UPDATE.
 */

import { db, pool } from "@workspace/db";
import { companiesTable, usersTable } from "@workspace/db/schema";
import bcrypt from "bcryptjs";

const DEMO_PASSWORD = "Demo1234!";

async function seed() {
  console.log("Seeding demo accounts...");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const [paradise] = await db
    .insert(companiesTable)
    .values({ name: "Paradise Freight System", slug: "paradise-freight-system", active: true })
    .onConflictDoUpdate({
      target: companiesTable.slug,
      set: { name: "Paradise Freight System", active: true, updatedAt: new Date() },
    })
    .returning();

  await db
    .insert(usersTable)
    .values({
      name: "mistri360 Platform Admin",
      email: "platform@maintiq.ca",
      passwordHash,
      role: "platform_admin",
      active: true,
      companyId: null,
    })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: {
        name: "mistri360 Platform Admin",
        passwordHash,
        role: "platform_admin",
        active: true,
        companyId: null,
        updatedAt: new Date(),
      },
    });

  const demoUsers = [
    {
      name: "Palwinder Singh",
      email: "admin@paradise-freight.com",
      passwordHash,
      role: "admin" as const,
      active: true,
      phone: "647-529-3908",
      companyId: paradise.id,
    },
    {
      name: "Palwinder Singh",
      email: "manager@paradise-freight.com",
      passwordHash,
      role: "manager" as const,
      active: true,
      phone: null,
      companyId: paradise.id,
    },
    {
      name: "Dharminder Singh",
      email: "mechanic@paradise-freight.com",
      passwordHash,
      role: "mechanic" as const,
      active: true,
      phone: null,
      companyId: paradise.id,
    },
    {
      name: "Defect Reporter",
      email: "driver@paradise-freight.com",
      passwordHash,
      role: "driver" as const,
      active: true,
      phone: null,
      companyId: paradise.id,
    },
  ];

  for (const user of demoUsers) {
    await db
      .insert(usersTable)
      .values(user)
      .onConflictDoUpdate({
        target: usersTable.email,
        set: {
          name: user.name,
          passwordHash: user.passwordHash,
          role: user.role,
          active: user.active,
          phone: user.phone,
          companyId: paradise.id,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${user.role}: ${user.email}`);
  }

  console.log("Seeding complete.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
