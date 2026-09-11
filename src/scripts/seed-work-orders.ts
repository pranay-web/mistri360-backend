/**
 * Seed a handful of demo work orders across different statuses.
 * Run: pnpm --filter @workspace/api-server tsx src/scripts/seed-work-orders.ts
 */
import { db } from "@workspace/db";
import { companiesTable, workOrdersTable, workOrderStatusHistoryTable, partsUsedTable, workOrderCommentsTable } from "@workspace/db/schema";
import { usersTable, vehiclesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  const [paradise] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.slug, "paradise-freight-system")).limit(1);
  if (!paradise) throw new Error("Paradise Freight System is missing; run the main seed first.");
  const [mechanic] = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.role, "mechanic"), eq(usersTable.companyId, paradise.id))).limit(1);
  const [manager] = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.role, "manager"), eq(usersTable.companyId, paradise.id))).limit(1);
  const vehicles = await db.select({ id: vehiclesTable.id, unitNumber: vehiclesTable.unitNumber }).from(vehiclesTable).where(eq(vehiclesTable.companyId, paradise.id)).limit(6);

  if (!mechanic || !manager || vehicles.length < 3) {
    console.error("Demo users or vehicles not found. Run main seed script first.");
    process.exit(1);
  }

  const demoWOs = [
    {
      woNumber: "WO-2026-0100",
      vehicleId: vehicles[0].id,
      workOrderType: "pm1",
      status: "repair_in_progress",
      priority: "normal",
      description: "PM1 oil change, filters, and 69-point inspection",
      assignedMechanicId: mechanic.id,
      createdByUserId: manager.id,
      scheduledDate: new Date("2026-07-28"),
      odometerAtService: 148320,
    },
    {
      woNumber: "WO-2026-0101",
      vehicleId: vehicles[1].id,
      workOrderType: "breakdown",
      status: "waiting_for_part",
      priority: "critical",
      description: "Air compressor failure — truck parked at yard",
      assignedMechanicId: mechanic.id,
      createdByUserId: manager.id,
      scheduledDate: new Date("2026-07-29"),
      odometerAtService: 213450,
    },
    {
      woNumber: "WO-2026-0102",
      vehicleId: vehicles[2].id,
      workOrderType: "pm2",
      status: "qc_review",
      priority: "normal",
      description: "PM2 full service including brake adjustment and tire rotation",
      assignedMechanicId: mechanic.id,
      createdByUserId: manager.id,
      scheduledDate: new Date("2026-07-27"),
      odometerAtService: 95000,
    },
    {
      woNumber: "WO-2026-0103",
      vehicleId: vehicles[3]?.id ?? vehicles[0].id,
      workOrderType: "driver_defect",
      status: "approval_required",
      priority: "high",
      description: "Driver reported check engine light and rough idle",
      assignedMechanicId: mechanic.id,
      createdByUserId: mechanic.id,
      scheduledDate: new Date("2026-07-30"),
    },
    {
      woNumber: "WO-2026-0104",
      vehicleId: vehicles[4]?.id ?? vehicles[1].id,
      workOrderType: "greasing",
      status: "completed",
      priority: "low",
      description: "Full chassis greasing and 5th wheel plate",
      assignedMechanicId: mechanic.id,
      createdByUserId: manager.id,
      scheduledDate: new Date("2026-07-25"),
      odometerAtService: 78300,
    },
    {
      woNumber: "WO-2026-0105",
      vehicleId: vehicles[5]?.id ?? vehicles[2].id,
      workOrderType: "pmcvi_prep",
      status: "out_of_service",
      priority: "critical",
      description: "Failed PMCVI — cracked frame rail, OOS until repaired and re-inspected",
      createdByUserId: manager.id,
      scheduledDate: new Date("2026-07-26"),
    },
  ];

  for (const wo of demoWOs) {
    const existing = await db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(eq(workOrdersTable.woNumber, wo.woNumber)).limit(1);
    if (existing.length) { console.log(`Skip ${wo.woNumber} (exists)`); continue; }

    const [inserted] = await db.insert(workOrdersTable).values({ ...wo, companyId: paradise.id } as any).returning({ id: workOrdersTable.id });
    console.log(`Created ${wo.woNumber} (${wo.status})`);

    // Status history entry
    await db.insert(workOrderStatusHistoryTable).values({
      workOrderId: inserted.id,
      fromStatus: null,
      toStatus: "draft",
      changedByUserId: wo.createdByUserId,
      notes: "Work order created",
    });
    await db.insert(workOrderStatusHistoryTable).values({
      workOrderId: inserted.id,
      fromStatus: "draft" as any,
      toStatus: wo.status as any,
      changedByUserId: wo.assignedMechanicId ?? wo.createdByUserId,
    });

    // Sample part for PM jobs
    if (["pm1", "pm2"].includes(wo.workOrderType) && wo.status !== "draft") {
      await db.insert(partsUsedTable).values({
        workOrderId: inserted.id,
        vendorName: "FleetPro Supply",
        partDescription: wo.workOrderType === "pm1" ? "Engine Oil Filter" : "Fuel Filter",
        partNumber: wo.workOrderType === "pm1" ? "FP-7317" : "FP-33480",
        quantity: "1",
        unitCost: wo.workOrderType === "pm1" ? "18.50" : "32.00",
        totalCost: wo.workOrderType === "pm1" ? "18.50" : "32.00",
      });
    }

    // Comment
    await db.insert(workOrderCommentsTable).values({
      workOrderId: inserted.id,
      authorId: wo.createdByUserId,
      body: "Work order opened. Vehicle checked in to shop.",
    });
  }

  console.log("Done seeding work orders.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
