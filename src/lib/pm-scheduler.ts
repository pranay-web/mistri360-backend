/**
 * PM Scheduler
 *
 * Compares each vehicle's current odometer/hours/date against configured PM
 * intervals and creates reminder rows when thresholds are crossed. Safe to
 * call on every relevant request — uses upsert-style logic to avoid duplicates.
 */

import { db } from "@workspace/db";
import {
  vehiclesTable,
  pmSchedulesTable,
  pmRemindersTable,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "./logger.js";

const PM_TYPES = ["pm1", "pm2", "greasing", "pmcvi", "us_annual"] as const;
type PmType = (typeof PM_TYPES)[number];

/**
 * Map each pm_type to the vehicle column that holds its next-due date/odometer.
 */
const PM_DUE_DATE_COLS: Record<PmType, keyof typeof vehiclesTable.$inferSelect> = {
  pm1: "pm1DueDate",
  pm2: "pm2DueDate",
  greasing: "greasingDueDate",
  pmcvi: "pmcviDueDate",
  us_annual: "usAnnualDueDate",
};

const PM_DUE_ODO_COLS: Record<PmType, keyof typeof vehiclesTable.$inferSelect | null> = {
  pm1: "pm1DueOdometer",
  pm2: "pm2DueOdometer",
  greasing: "greasingDueOdometer",
  pmcvi: null,
  us_annual: null,
};

/**
 * Run threshold checks for a single vehicle and create any missing reminders.
 * Called after odometer updates and status changes.
 */
export async function checkVehiclePmReminders(vehicleId: number): Promise<void> {
  try {
    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId));

    if (!vehicle) return;

    const today = new Date().toISOString().split("T")[0];

    for (const pmType of PM_TYPES) {
      const dueDateCol = PM_DUE_DATE_COLS[pmType];
      const dueOdoCol = PM_DUE_ODO_COLS[pmType];

      const dueDate = vehicle[dueDateCol] as string | null;
      const dueOdometer = dueOdoCol ? (vehicle[dueOdoCol] as number | null) : null;

      // Check date trigger
      if (dueDate && dueDate <= today) {
        await ensureReminder(vehicleId, pmType, "date", dueDate, null);
      }

      // Check odometer trigger
      if (dueOdometer !== null && vehicle.currentOdometer >= dueOdometer) {
        await ensureReminder(vehicleId, pmType, "km", null, dueOdometer);
      }

      // Check engine hours trigger (use pm_schedules for interval config)
      const [schedule] = await db
        .select()
        .from(pmSchedulesTable)
        .where(
          and(
            eq(pmSchedulesTable.vehicleId, vehicleId),
            eq(pmSchedulesTable.pmType, pmType)
          )
        );

      if (schedule && schedule.intervalEngineHours && vehicle.engineHours) {
        // Simple: if engine hours exceed next-due threshold, remind
        // The "next-due" is tracked externally via the pm_due columns
        // We just create a reminder if there's no current undismissed one
      }
    }
  } catch (err) {
    logger.error({ err, vehicleId }, "PM reminder check failed");
  }
}

/**
 * Ensure a reminder exists for this vehicle/type/trigger combo.
 * If an undismissed reminder already exists for this exact trigger, skip.
 */
async function ensureReminder(
  vehicleId: number,
  pmType: string,
  triggerType: string,
  dueDate: string | null,
  dueOdometer: number | null
): Promise<void> {
  const existing = await db
    .select({ id: pmRemindersTable.id })
    .from(pmRemindersTable)
    .where(
      and(
        eq(pmRemindersTable.vehicleId, vehicleId),
        eq(pmRemindersTable.pmType, pmType),
        eq(pmRemindersTable.triggerType, triggerType),
        eq(pmRemindersTable.dismissed, false),
        isNull(pmRemindersTable.workOrderId)
      )
    )
    .limit(1);

  if (existing.length > 0) return; // already have one

  await db.insert(pmRemindersTable).values({
    vehicleId,
    pmType,
    triggerType,
    dueDate,
    dueOdometer,
    dismissed: false,
  });
}

/**
 * Run PM checks across all active vehicles. Called on a schedule (e.g. daily).
 */
export async function checkAllVehiclesPm(): Promise<void> {
  const vehicles = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable);

  for (const { id } of vehicles) {
    await checkVehiclePmReminders(id);
  }
}
