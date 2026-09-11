/**
 * Seed script — demo vehicles for Fleet Maintenance.
 * Run: pnpm --filter @workspace/api-server run seed:vehicles
 * Safe to run multiple times (uses ON CONFLICT on unit_number).
 */

import { db, pool } from "@workspace/db";
import { companiesTable, vehiclesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function seedVehicles() {
  console.log("Seeding demo vehicles...");
  const [paradise] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.slug, "paradise-freight-system")).limit(1);
  if (!paradise) throw new Error("Paradise Freight System is missing; run the main seed first.");

  const today = new Date();
  const addDays = (d: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + d);
    return dt.toISOString().split("T")[0];
  };

  const vehicles: (typeof vehiclesTable.$inferInsert)[] = [
    {
      unitNumber: "T-101",
      vehicleType: "truck",
      status: "available",
      vin: "1HSHBAHR4CJ612001",
      licensePlate: "AB12345",
      licenseProvince: "ON",
      year: 2020,
      make: "Kenworth",
      model: "T680",
      color: "White",
      currentOdometer: 285000,
      engineHours: "4200.5",
      reeferHours: null,
      pm1DueDate: addDays(-3),        // OVERDUE
      pm1DueOdometer: 285000,
      pm2DueDate: addDays(45),
      pm2DueOdometer: 310000,
      greasingDueDate: addDays(7),    // DUE SOON
      greasingDueOdometer: 292000,
      pmcviDueDate: addDays(60),
      usAnnualDueDate: addDays(90),
      registrationExpiry: addDays(180),
      insuranceExpiry: addDays(240),
      notes: "Check brake linings at next PM",
    },
    {
      unitNumber: "T-102",
      vehicleType: "truck",
      status: "in_repair",
      vin: "1XKDDB9X6EJ424002",
      licensePlate: "AB22234",
      licenseProvince: "ON",
      year: 2021,
      make: "Peterbilt",
      model: "389",
      color: "Black",
      currentOdometer: 198000,
      engineHours: "3100.0",
      reeferHours: null,
      pm1DueDate: addDays(30),
      pm1DueOdometer: 210000,
      pm2DueDate: addDays(90),
      pm2DueOdometer: 250000,
      greasingDueDate: addDays(20),
      greasingDueOdometer: 205000,
      pmcviDueDate: addDays(120),
      usAnnualDueDate: addDays(200),
      registrationExpiry: addDays(90),
      insuranceExpiry: addDays(300),
      notes: "In shop for transmission repair",
    },
    {
      unitNumber: "T-103",
      vehicleType: "truck",
      status: "available",
      vin: "3HSCUAPR0EN123003",
      licensePlate: "AB33312",
      licenseProvince: "AB",
      year: 2019,
      make: "International",
      model: "LT625",
      color: "Silver",
      currentOdometer: 412000,
      engineHours: "6800.2",
      reeferHours: null,
      pm1DueDate: addDays(10),        // DUE SOON
      pm1DueOdometer: 425000,
      pm2DueDate: addDays(60),
      pm2DueOdometer: 460000,
      greasingDueDate: addDays(25),
      greasingDueOdometer: 420000,
      pmcviDueDate: addDays(45),
      usAnnualDueDate: addDays(100),
      registrationExpiry: addDays(120),
      insuranceExpiry: addDays(360),
      notes: null,
    },
    {
      unitNumber: "T-201",
      vehicleType: "reefer_trailer",
      status: "available",
      vin: "1JJV532B2WL702004",
      licensePlate: "TR99001",
      licenseProvince: "ON",
      year: 2022,
      make: "Utility",
      model: "3000R",
      color: "White",
      currentOdometer: 145000,
      engineHours: null,
      reeferHours: "2100.0",
      pm1DueDate: addDays(60),
      pm1DueOdometer: 165000,
      pm2DueDate: null,
      pm2DueOdometer: null,
      greasingDueDate: addDays(14),   // DUE SOON
      greasingDueOdometer: null,
      pmcviDueDate: addDays(180),
      usAnnualDueDate: addDays(220),
      registrationExpiry: addDays(200),
      insuranceExpiry: addDays(300),
      notes: "Thermo King unit S/N TK-2210",
    },
    {
      unitNumber: "T-202",
      vehicleType: "trailer",
      status: "out_of_service",
      vin: "1GRAP06X53E102005",
      licensePlate: "TR99002",
      licenseProvince: "ON",
      year: 2018,
      make: "Wabash",
      model: "National DuraPlate",
      color: "White",
      currentOdometer: 320000,
      engineHours: null,
      reeferHours: null,
      pm1DueDate: addDays(-15),       // OVERDUE
      pm1DueOdometer: 315000,
      pm2DueDate: addDays(-5),        // OVERDUE
      pm2DueOdometer: null,
      greasingDueDate: null,
      greasingDueOdometer: null,
      pmcviDueDate: addDays(-30),     // OVERDUE
      usAnnualDueDate: addDays(60),
      registrationExpiry: addDays(30),
      insuranceExpiry: addDays(200),
      notes: "Needs frame inspection — placed OOS pending repair",
    },
    {
      unitNumber: "T-203",
      vehicleType: "trailer",
      status: "restricted",
      vin: "3H3V532C0NJ704006",
      licensePlate: "TR99003",
      licenseProvince: "QC",
      year: 2023,
      make: "Great Dane",
      model: "Everest SS",
      color: "White",
      currentOdometer: 78000,
      engineHours: null,
      reeferHours: null,
      pm1DueDate: addDays(90),
      pm1DueOdometer: 100000,
      pm2DueDate: null,
      pm2DueOdometer: null,
      greasingDueDate: addDays(45),
      greasingDueOdometer: null,
      pmcviDueDate: addDays(300),
      usAnnualDueDate: null,
      registrationExpiry: addDays(350),
      insuranceExpiry: addDays(350),
      notes: "Restricted — light cargo only pending suspension check",
    },
  ];

  for (const vehicle of vehicles) {
    await db
      .insert(vehiclesTable)
      .values({ ...vehicle, companyId: paradise.id })
      .onConflictDoUpdate({
        target: vehiclesTable.unitNumber,
        set: {
          status: vehicle.status,
          currentOdometer: vehicle.currentOdometer,
          pm1DueDate: vehicle.pm1DueDate,
          notes: vehicle.notes,
          companyId: paradise.id,
        },
      });
    console.log(`  ✓ ${vehicle.vehicleType} ${vehicle.unitNumber} — ${vehicle.status}`);
  }

  console.log("Vehicle seeding complete.");
  await pool.end();
}

seedVehicles().catch((err) => {
  console.error("Vehicle seed failed:", err);
  process.exit(1);
});
