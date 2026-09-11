/**
 * Seed PM1, PM2, trailer and reefer checklist templates.
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/seed-checklists.ts
 */
import { db } from "@workspace/db";
import { checklistTemplatesTable, checklistItemsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

type ItemDef = {
  category: string;
  itemDescription: string;
  requiresMeasurement?: boolean;
  measurementUnit?: string;
  sortOrder: number;
};

// ── PM1 items (standard preventative maintenance) ─────────────────────────────
const PM1_ITEMS: ItemDef[] = [
  // Engine & Fluids
  { category: "Engine & Fluids", itemDescription: "Engine oil level", sortOrder: 10 },
  { category: "Engine & Fluids", itemDescription: "Engine oil condition / color", sortOrder: 11 },
  { category: "Engine & Fluids", itemDescription: "Coolant level & condition", sortOrder: 12 },
  { category: "Engine & Fluids", itemDescription: "Power steering fluid level", sortOrder: 13 },
  { category: "Engine & Fluids", itemDescription: "Windshield washer fluid level", sortOrder: 14 },
  { category: "Engine & Fluids", itemDescription: "Battery condition & terminals", sortOrder: 15 },
  { category: "Engine & Fluids", itemDescription: "Air filter condition", sortOrder: 16 },
  { category: "Engine & Fluids", itemDescription: "Belts & hoses — condition", sortOrder: 17 },
  { category: "Engine & Fluids", itemDescription: "Fuel/water separator — drain & inspect", sortOrder: 18 },
  { category: "Engine & Fluids", itemDescription: "Engine mounts — condition", sortOrder: 19 },
  // Brakes
  { category: "Brakes", itemDescription: "Brake pedal feel & travel", sortOrder: 20 },
  { category: "Brakes", itemDescription: "Air pressure build-up (0–100 psi time)", sortOrder: 21 },
  { category: "Brakes", itemDescription: "Low air warning buzzer / light", sortOrder: 22 },
  { category: "Brakes", itemDescription: "Front (steer axle) brake pads / linings", sortOrder: 23 },
  { category: "Brakes", itemDescription: "Drive axle brake pads / linings", sortOrder: 24 },
  { category: "Brakes", itemDescription: "Air lines & fittings — no leaks", sortOrder: 25 },
  { category: "Brakes", itemDescription: "Brake drums / rotors — condition", sortOrder: 26 },
  { category: "Brakes", itemDescription: "Parking brake — operation & holding", sortOrder: 27 },
  // Tires & Wheels
  { category: "Tires & Wheels", itemDescription: "Front left steer tire pressure", requiresMeasurement: true, measurementUnit: "psi", sortOrder: 30 },
  { category: "Tires & Wheels", itemDescription: "Front right steer tire pressure", requiresMeasurement: true, measurementUnit: "psi", sortOrder: 31 },
  { category: "Tires & Wheels", itemDescription: "Drive axle tire pressures (all)", requiresMeasurement: true, measurementUnit: "psi", sortOrder: 32 },
  { category: "Tires & Wheels", itemDescription: "Steer tire tread depth", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 33 },
  { category: "Tires & Wheels", itemDescription: "Drive tire tread depth", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 34 },
  { category: "Tires & Wheels", itemDescription: "Tire condition — cuts, bulges, damage", sortOrder: 35 },
  { category: "Tires & Wheels", itemDescription: "Lug nuts — tight / torque check", sortOrder: 36 },
  { category: "Tires & Wheels", itemDescription: "Hub oil seals — no leaks", sortOrder: 37 },
  // Lights & Electrical
  { category: "Lights & Electrical", itemDescription: "Headlights — high & low beam", sortOrder: 40 },
  { category: "Lights & Electrical", itemDescription: "Taillights & running lights", sortOrder: 41 },
  { category: "Lights & Electrical", itemDescription: "Brake lights", sortOrder: 42 },
  { category: "Lights & Electrical", itemDescription: "Turn signals — front & rear", sortOrder: 43 },
  { category: "Lights & Electrical", itemDescription: "Hazard lights", sortOrder: 44 },
  { category: "Lights & Electrical", itemDescription: "Reverse lights & alarm", sortOrder: 45 },
  { category: "Lights & Electrical", itemDescription: "Marker / clearance lights", sortOrder: 46 },
  { category: "Lights & Electrical", itemDescription: "Dashboard warning lights — none active", sortOrder: 47 },
  // Steering & Suspension
  { category: "Steering & Suspension", itemDescription: "Steering free play", sortOrder: 50 },
  { category: "Steering & Suspension", itemDescription: "Tie rod ends & drag link", sortOrder: 51 },
  { category: "Steering & Suspension", itemDescription: "King pins — wear check", sortOrder: 52 },
  { category: "Steering & Suspension", itemDescription: "Spring leaves / air bags", sortOrder: 53 },
  { category: "Steering & Suspension", itemDescription: "Shock absorbers", sortOrder: 54 },
  { category: "Steering & Suspension", itemDescription: "Frame & cross members", sortOrder: 55 },
  // Cab & Safety Equipment
  { category: "Cab & Safety", itemDescription: "Seat belts & mountings", sortOrder: 60 },
  { category: "Cab & Safety", itemDescription: "Fire extinguisher — charged & accessible", sortOrder: 61 },
  { category: "Cab & Safety", itemDescription: "Emergency triangles / flares", sortOrder: 62 },
  { category: "Cab & Safety", itemDescription: "First aid kit", sortOrder: 63 },
  { category: "Cab & Safety", itemDescription: "Windshield — cracks / chips", sortOrder: 64 },
  { category: "Cab & Safety", itemDescription: "Mirrors — condition & adjustment", sortOrder: 65 },
  { category: "Cab & Safety", itemDescription: "Wipers & washer operation", sortOrder: 66 },
  { category: "Cab & Safety", itemDescription: "Horn", sortOrder: 67 },
  { category: "Cab & Safety", itemDescription: "A/C & heater operation", sortOrder: 68 },
  { category: "Cab & Safety", itemDescription: "Cab mounts, steps & handrails", sortOrder: 69 },
];

// ── PM2 = all PM1 items + additional advanced sections ────────────────────────
const PM2_EXTRA_ITEMS: ItemDef[] = [
  // Brake Measurements
  { category: "Brake Measurements", itemDescription: "Steer axle brake lining thickness", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 70 },
  { category: "Brake Measurements", itemDescription: "Drive axle #1 brake lining thickness", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 71 },
  { category: "Brake Measurements", itemDescription: "Drive axle #2 brake lining thickness (if equipped)", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 72 },
  { category: "Brake Measurements", itemDescription: "Steer axle slack adjuster push rod stroke", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 73 },
  { category: "Brake Measurements", itemDescription: "Drive axle slack adjuster push rod stroke", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 74 },
  { category: "Brake Measurements", itemDescription: "Brake drum diameter — steer axle", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 75 },
  { category: "Brake Measurements", itemDescription: "Brake drum diameter — drive axle", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 76 },
  // Diagnostics
  { category: "Diagnostics", itemDescription: "OBD scan — active / pending fault codes", sortOrder: 80 },
  { category: "Diagnostics", itemDescription: "Coolant system pressure test", sortOrder: 81 },
  { category: "Diagnostics", itemDescription: "Engine oil pressure at idle", requiresMeasurement: true, measurementUnit: "psi", sortOrder: 82 },
  { category: "Diagnostics", itemDescription: "Engine idle RPM", requiresMeasurement: true, measurementUnit: "rpm", sortOrder: 83 },
  { category: "Diagnostics", itemDescription: "Exhaust smoke analysis — color / opacity", sortOrder: 84 },
  // Drivetrain
  { category: "Drivetrain", itemDescription: "Transmission fluid level & condition", sortOrder: 90 },
  { category: "Drivetrain", itemDescription: "Rear differential fluid level", sortOrder: 91 },
  { category: "Drivetrain", itemDescription: "Drive shaft U-joints / CV joints", sortOrder: 92 },
  { category: "Drivetrain", itemDescription: "Clutch operation & free play", sortOrder: 93 },
  { category: "Drivetrain", itemDescription: "Transmission mounts — condition", sortOrder: 94 },
  // Road Test
  { category: "Road Test", itemDescription: "Overall braking effectiveness", sortOrder: 100 },
  { category: "Road Test", itemDescription: "Steering response & alignment", sortOrder: 101 },
  { category: "Road Test", itemDescription: "Transmission shift quality", sortOrder: 102 },
  { category: "Road Test", itemDescription: "Unusual noises or vibrations", sortOrder: 103 },
  { category: "Road Test", itemDescription: "Engine performance under load", sortOrder: 104 },
];

// ── Trailer items ─────────────────────────────────────────────────────────────
const TRAILER_ITEMS: ItemDef[] = [
  // Structural
  { category: "Structural", itemDescription: "Frame & cross members — condition", sortOrder: 10 },
  { category: "Structural", itemDescription: "Floor boards — condition", sortOrder: 11 },
  { category: "Structural", itemDescription: "Side walls & upper rail", sortOrder: 12 },
  { category: "Structural", itemDescription: "Roof & top rail", sortOrder: 13 },
  { category: "Structural", itemDescription: "Nose bulkhead — condition", sortOrder: 14 },
  // Lights & Electrical
  { category: "Lights & Electrical", itemDescription: "Running / clearance lights — all operational", sortOrder: 20 },
  { category: "Lights & Electrical", itemDescription: "Brake lights", sortOrder: 21 },
  { category: "Lights & Electrical", itemDescription: "Turn signals", sortOrder: 22 },
  { category: "Lights & Electrical", itemDescription: "Marker lights", sortOrder: 23 },
  { category: "Lights & Electrical", itemDescription: "7-pin connector — condition & function", sortOrder: 24 },
  { category: "Lights & Electrical", itemDescription: "ABS indicator lamp — check", sortOrder: 25 },
  // Brakes
  { category: "Brakes", itemDescription: "Brake chambers — no external leaks", sortOrder: 30 },
  { category: "Brakes", itemDescription: "Slack adjusters — push rod stroke", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 31 },
  { category: "Brakes", itemDescription: "Brake drums — condition & cracks", sortOrder: 32 },
  { category: "Brakes", itemDescription: "Brake lining thickness", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 33 },
  { category: "Brakes", itemDescription: "Air lines & glad hands — no leaks", sortOrder: 34 },
  { category: "Brakes", itemDescription: "Trailer brake test — effectiveness", sortOrder: 35 },
  // Tires & Wheels
  { category: "Tires & Wheels", itemDescription: "Tire pressures — all positions", requiresMeasurement: true, measurementUnit: "psi", sortOrder: 40 },
  { category: "Tires & Wheels", itemDescription: "Tire tread depth", requiresMeasurement: true, measurementUnit: "mm", sortOrder: 41 },
  { category: "Tires & Wheels", itemDescription: "Tire sidewalls — damage / bulges", sortOrder: 42 },
  { category: "Tires & Wheels", itemDescription: "Hub oil seals — no leaks", sortOrder: 43 },
  { category: "Tires & Wheels", itemDescription: "Lug nuts — tight", sortOrder: 44 },
  { category: "Tires & Wheels", itemDescription: "Wheel end bearings — no play / overheating", sortOrder: 45 },
  // Coupling & Landing Gear
  { category: "Coupling & Landing Gear", itemDescription: "King pin — wear & lubrication", sortOrder: 50 },
  { category: "Coupling & Landing Gear", itemDescription: "Apron & locking jaws — condition", sortOrder: 51 },
  { category: "Coupling & Landing Gear", itemDescription: "Safety chains / cables", sortOrder: 52 },
  { category: "Coupling & Landing Gear", itemDescription: "Landing gear — operation & crank", sortOrder: 53 },
  { category: "Coupling & Landing Gear", itemDescription: "Trailer connector — pin condition", sortOrder: 54 },
  { category: "Coupling & Landing Gear", itemDescription: "Breakaway cable / cord — intact", sortOrder: 55 },
  // Doors & Cargo
  { category: "Doors & Cargo", itemDescription: "Rear door hinges & latches", sortOrder: 60 },
  { category: "Doors & Cargo", itemDescription: "Rear door seals", sortOrder: 61 },
  { category: "Doors & Cargo", itemDescription: "Side door (if equipped)", sortOrder: 62 },
  { category: "Doors & Cargo", itemDescription: "Tie-down rings / E-track — secure", sortOrder: 63 },
  { category: "Doors & Cargo", itemDescription: "Interior lighting (if equipped)", sortOrder: 64 },
  { category: "Doors & Cargo", itemDescription: "Rear bumper & ICC guard", sortOrder: 65 },
];

// ── Reefer = all Trailer items + refrigeration sections ───────────────────────
const REEFER_EXTRA_ITEMS: ItemDef[] = [
  // Refrigeration Engine & Fuel
  { category: "Refrigeration — Engine & Fuel", itemDescription: "Fuel level", sortOrder: 70 },
  { category: "Refrigeration — Engine & Fuel", itemDescription: "Engine oil level", sortOrder: 71 },
  { category: "Refrigeration — Engine & Fuel", itemDescription: "Coolant level", sortOrder: 72 },
  { category: "Refrigeration — Engine & Fuel", itemDescription: "Air filter condition", sortOrder: 73 },
  { category: "Refrigeration — Engine & Fuel", itemDescription: "Belts & idler pulleys", sortOrder: 74 },
  { category: "Refrigeration — Engine & Fuel", itemDescription: "Engine mounts — condition", sortOrder: 75 },
  // Refrigeration Mechanical
  { category: "Refrigeration — Mechanical", itemDescription: "Compressor operation — no abnormal noises", sortOrder: 80 },
  { category: "Refrigeration — Mechanical", itemDescription: "Refrigerant level — visual / sight glass", sortOrder: 81 },
  { category: "Refrigeration — Mechanical", itemDescription: "Condenser coils — clean & undamaged", sortOrder: 82 },
  { category: "Refrigeration — Mechanical", itemDescription: "Evaporator coils — no excessive frost", sortOrder: 83 },
  { category: "Refrigeration — Mechanical", itemDescription: "Condenser fan — operation", sortOrder: 84 },
  { category: "Refrigeration — Mechanical", itemDescription: "Evaporator fan — operation", sortOrder: 85 },
  // Controls & Temperature
  { category: "Refrigeration — Controls", itemDescription: "Temperature controller display — accurate", sortOrder: 90 },
  { category: "Refrigeration — Controls", itemDescription: "Set point operation — cooling mode", sortOrder: 91 },
  { category: "Refrigeration — Controls", itemDescription: "Set point operation — heating mode (if equipped)", sortOrder: 92 },
  { category: "Refrigeration — Controls", itemDescription: "Defrost cycle — operation", sortOrder: 93 },
  { category: "Refrigeration — Controls", itemDescription: "Remote monitoring unit (if equipped)", sortOrder: 94 },
  // Air Distribution & Sealing
  { category: "Air Distribution & Sealing", itemDescription: "Air chute / air duct — condition", sortOrder: 100 },
  { category: "Air Distribution & Sealing", itemDescription: "Return air screen — clean & clear", sortOrder: 101 },
  { category: "Air Distribution & Sealing", itemDescription: "Bulkhead — condition & seals", sortOrder: 102 },
  { category: "Air Distribution & Sealing", itemDescription: "Door gaskets / seals — no air infiltration", sortOrder: 103 },
  { category: "Air Distribution & Sealing", itemDescription: "Floor drain plugs — in place", sortOrder: 104 },
  { category: "Air Distribution & Sealing", itemDescription: "Pre-trip cool-down test — reaches set temp", sortOrder: 105 },
];

async function seedTemplate(
  type: "pm1" | "pm2" | "trailer" | "reefer",
  name: string,
  description: string,
  items: ItemDef[]
) {
  const existing = await db
    .select({ id: checklistTemplatesTable.id })
    .from(checklistTemplatesTable)
    .where(eq(checklistTemplatesTable.checklistType, type))
    .limit(1);

  if (existing.length) {
    console.log(`Skip ${type} template (exists)`);
    return;
  }

  const [tmpl] = await db
    .insert(checklistTemplatesTable)
    .values({ checklistType: type, name, description })
    .returning({ id: checklistTemplatesTable.id });

  for (const item of items) {
    await db.insert(checklistItemsTable).values({
      templateId: tmpl.id,
      category: item.category,
      itemDescription: item.itemDescription,
      requiresMeasurement: item.requiresMeasurement ?? false,
      measurementUnit: item.measurementUnit ?? null,
      sortOrder: item.sortOrder,
    });
  }
  console.log(`Created ${type} template with ${items.length} items`);
}

async function main() {
  await seedTemplate("pm1", "PM1 Inspection", "Standard preventative maintenance inspection", PM1_ITEMS);
  await seedTemplate("pm2", "PM2 Inspection", "Full preventative maintenance including advanced checks", [...PM1_ITEMS, ...PM2_EXTRA_ITEMS]);
  await seedTemplate("trailer", "Trailer Inspection", "Trailer safety and maintenance inspection", TRAILER_ITEMS);
  await seedTemplate("reefer", "Reefer Inspection", "Refrigeration trailer inspection", [...TRAILER_ITEMS, ...REEFER_EXTRA_ITEMS]);
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
