/**
 * Fleet Expansion Seed
 * Adds 40 Volvo trucks (PF101–PF140, 2020–2024) and 80 53' dry-van trailers (PT101–PT180).
 * Run: pnpm --filter @workspace/api-server run seed:fleet
 * Safe to re-run — uses ON CONFLICT on unit_number.
 */

import { db, pool } from "@workspace/db";
import { companiesTable, vehiclesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const today = new Date();
const addDays = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
};

// ── VIN helpers ───────────────────────────────────────────────────────────────
const YEAR_CODE: Record<number, string> = { 2020: "L", 2021: "M", 2022: "N", 2023: "P", 2024: "R" };
function truckVin(year: number, seq: number) {
  return `4V4NC9EH${YEAR_CODE[year] ?? "N"}J${String(seq).padStart(6, "0")}`;
}
function trailerVin(seq: number) {
  return `1JJV532B${String(seq % 9) + "N"}J${String(seq).padStart(6, "0")}`;
}

// ── Truck data ────────────────────────────────────────────────────────────────
type Status = "available" | "in_repair" | "out_of_service" | "restricted" | "inactive";

const VOLVO_MODELS = ["VNL 760", "VNL 860", "VNL 740", "VNL 300"];
const TRUCK_COLORS = ["White", "White", "White", "Silver", "Black", "Arctic White", "White", "Silver"];
const PROVINCES = ["ON", "ON", "ON", "ON", "AB", "BC", "QC", "MB"];

// Year groups: 8 units per model year
const TRUCK_YEAR_GROUPS: { year: number; startIdx: number }[] = [
  { year: 2024, startIdx: 0 },
  { year: 2023, startIdx: 8 },
  { year: 2022, startIdx: 16 },
  { year: 2021, startIdx: 24 },
  { year: 2020, startIdx: 32 },
];

// Odometer ranges by year (km)
const ODO_RANGE: Record<number, [number, number]> = {
  2024: [5_000,   90_000],
  2023: [60_000,  180_000],
  2022: [130_000, 280_000],
  2021: [220_000, 380_000],
  2020: [310_000, 520_000],
};

// Status distribution per group of 8
const STATUS_PATTERN: Status[] = [
  "available", "available", "available", "available",
  "available", "in_repair", "available", "available",
];
// Override specific indices for variety
const STATUS_OVERRIDES: Record<number, Status> = {
  3:  "out_of_service",
  11: "restricted",
  19: "in_repair",
  27: "out_of_service",
  35: "in_repair",
  38: "restricted",
  39: "inactive",
};

function truckOdo(year: number, seed: number): number {
  const [lo, hi] = ODO_RANGE[year];
  const range = hi - lo;
  return lo + Math.round((range * ((seed * 1327 + 42) % 100)) / 100 / 5000) * 5000;
}

function engineHours(odo: number): string {
  // roughly 1 engine hour per 65 km
  return (Math.round((odo / 65) * 10) / 10).toFixed(1);
}

// ── Trailer makes / models ─────────────────────────────────────────────────────
const TRAILER_SPECS = [
  { make: "Wabash National", model: "National DuraPlate 53'" },
  { make: "Great Dane",      model: "Highcube 53 DryVan"     },
  { make: "Utility",         model: "3000SE 53'"              },
  { make: "Stoughton",       model: "Z-Plate 53'"             },
  { make: "Vanguard",        model: "Super Seal 53'"          },
];
const TRAILER_YEAR_POOL = [2018, 2019, 2020, 2021, 2021, 2022, 2022, 2023, 2023, 2024];
const TRAILER_STATUS_PATTERN: Status[] = [
  "available","available","available","available","available",
  "available","available","available","in_repair","available",
];
const TRAILER_STATUS_OVERRIDES: Record<number, Status> = {
  4:  "out_of_service",
  14: "in_repair",
  24: "restricted",
  34: "out_of_service",
  44: "in_repair",
  54: "restricted",
  64: "in_repair",
  74: "out_of_service",
};

function trailerOdo(year: number, seed: number): number {
  const ageYears = today.getFullYear() - year;
  const base = ageYears * 40_000;
  const jitter = ((seed * 997 + 13) % 30_000);
  return Math.round((base + jitter) / 1000) * 1000;
}

// ── Build records ─────────────────────────────────────────────────────────────

function buildTrucks(): (typeof vehiclesTable.$inferInsert)[] {
  const trucks: (typeof vehiclesTable.$inferInsert)[] = [];

  for (let i = 0; i < 40; i++) {
    const unitNumber = `PF${101 + i}`;
    const groupInfo = TRUCK_YEAR_GROUPS.find(g => i >= g.startIdx && i < g.startIdx + 8)
      ?? TRUCK_YEAR_GROUPS[4];
    const year = groupInfo.year;
    const posInGroup = i - groupInfo.startIdx;
    const odo = truckOdo(year, i);
    const status: Status = STATUS_OVERRIDES[i] ?? STATUS_PATTERN[posInGroup];
    const model = VOLVO_MODELS[i % VOLVO_MODELS.length];
    const color = TRUCK_COLORS[i % TRUCK_COLORS.length];
    const province = PROVINCES[i % PROVINCES.length];

    // PM dates — stagger realistically
    const pm1Days  = (i % 7 === 0) ? -(i % 15 + 1) : (15 + (i * 13) % 60);
    const pm2Days  = pm1Days + 90;
    const grsDays  = (i % 9 === 0) ? -(i % 10 + 1) : (10 + (i * 17) % 45);
    const pmcvDays = 30 + (i * 23) % 330;
    const regDays  = 60 + (i * 19) % 300;
    const insDays  = 120 + (i * 31) % 300;

    trucks.push({
      unitNumber,
      vehicleType: "truck",
      status,
      vin: truckVin(year, 100 + i),
      licensePlate: `PF${String(1000 + i).padStart(4, "0")}`,
      licenseProvince: province,
      year,
      make: "Volvo",
      model,
      color,
      currentOdometer: odo,
      engineHours: engineHours(odo),
      reeferHours: null,
      pm1DueDate: addDays(pm1Days),
      pm1DueOdometer: odo + 25_000,
      pm2DueDate: addDays(pm2Days),
      pm2DueOdometer: odo + 80_000,
      greasingDueDate: addDays(grsDays),
      greasingDueOdometer: odo + 10_000,
      pmcviDueDate: addDays(pmcvDays),
      usAnnualDueDate: addDays(pmcvDays + 30),
      registrationExpiry: addDays(regDays),
      insuranceExpiry: addDays(insDays),
      notes: status === "in_repair" ? "In shop for scheduled maintenance" :
             status === "out_of_service" ? "Out of service — pending inspection" :
             status === "restricted" ? "Restricted — light loads only" :
             null,
    });
  }

  return trucks;
}

function buildTrailers(): (typeof vehiclesTable.$inferInsert)[] {
  const trailers: (typeof vehiclesTable.$inferInsert)[] = [];

  for (let i = 0; i < 80; i++) {
    const unitNumber = `PT${101 + i}`;
    const spec = TRAILER_SPECS[i % TRAILER_SPECS.length];
    const year = TRAILER_YEAR_POOL[i % TRAILER_YEAR_POOL.length];
    const odo = trailerOdo(year, i);
    const status: Status = TRAILER_STATUS_OVERRIDES[i] ?? TRAILER_STATUS_PATTERN[i % TRAILER_STATUS_PATTERN.length];

    const pm1Days  = (i % 8 === 0) ? -(i % 20 + 1) : (20 + (i * 11) % 70);
    const grsDays  = (i % 11 === 0) ? -(i % 8 + 1) : (7 + (i * 19) % 50);
    const pmcvDays = 45 + (i * 17) % 300;
    const regDays  = 90 + (i * 13) % 270;
    const insDays  = 150 + (i * 29) % 240;

    trailers.push({
      unitNumber,
      vehicleType: "trailer",
      status,
      vin: trailerVin(200 + i),
      licensePlate: `PT${String(1000 + i).padStart(4, "0")}`,
      licenseProvince: ["ON", "ON", "AB", "BC", "QC"][i % 5],
      year,
      make: spec.make,
      model: spec.model,
      color: "White",
      currentOdometer: odo,
      engineHours: null,
      reeferHours: null,
      pm1DueDate: addDays(pm1Days),
      pm1DueOdometer: odo > 0 ? odo + 30_000 : null,
      pm2DueDate: null,
      pm2DueOdometer: null,
      greasingDueDate: addDays(grsDays),
      greasingDueOdometer: null,
      pmcviDueDate: addDays(pmcvDays),
      usAnnualDueDate: addDays(pmcvDays + 45),
      registrationExpiry: addDays(regDays),
      insuranceExpiry: addDays(insDays),
      notes: status === "in_repair" ? "In shop for axle / brake service" :
             status === "out_of_service" ? "Out of service — floor or frame damage" :
             status === "restricted" ? "Restricted — reduced load rating" :
             null,
    });
  }

  return trailers;
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function run() {
  console.log("Seeding fleet expansion (40 trucks + 80 trailers)...\n");
  const [paradise] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.slug, "paradise-freight-system")).limit(1);
  if (!paradise) throw new Error("Paradise Freight System is missing; run the main seed first.");

  const trucks  = buildTrucks();
  const trailers = buildTrailers();
  const all = [...trucks, ...trailers];

  let inserted = 0;
  let updated  = 0;

  for (const v of all) {
    const result = await db
      .insert(vehiclesTable)
      .values({ ...v, companyId: paradise.id })
      .onConflictDoUpdate({
        target: vehiclesTable.unitNumber,
        set: {
          status: v.status,
          year: v.year,
          make: v.make,
          model: v.model,
          currentOdometer: v.currentOdometer,
          engineHours: v.engineHours,
          pm1DueDate: v.pm1DueDate,
          pm2DueDate: v.pm2DueDate,
          greasingDueDate: v.greasingDueDate,
          pmcviDueDate: v.pmcviDueDate,
          notes: v.notes,
          companyId: paradise.id,
        },
      })
      .returning({ id: vehiclesTable.id });

    const isNew = result[0]?.id != null;
    if (isNew) inserted++;
    else updated++;
    console.log(`  ${isNew ? "✓ added " : "↻ updated"} ${v.vehicleType.padEnd(14)} ${v.unitNumber.padEnd(8)} ${v.year} ${v.make} ${v.model} — ${v.status}`);
  }

  console.log(`\nDone. ${inserted} inserted, ${updated} updated.`);
  await pool.end();
}

run().catch((err) => {
  console.error("Fleet expansion seed failed:", err);
  process.exit(1);
});
