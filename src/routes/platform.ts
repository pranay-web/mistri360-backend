import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { companiesTable, usersTable } from "@workspace/db/schema";
import { requirePlatformAdmin } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const companyIdParams = z.object({ id: z.coerce.number().int().positive() });
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const password = z.string().min(8).max(128);
const createCompanyBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug,
  adminName: z.string().trim().min(1).max(200),
  adminEmail: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  adminPassword: password,
});
const createUserBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password,
  role: z.enum(["admin", "manager", "mechanic", "driver"]),
  phone: z.string().trim().max(50).nullable().optional(),
});
const updateCompanyBody = z.object({ active: z.boolean() });

function publicUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

router.get("/platform/companies", requirePlatformAdmin, async (_req, res): Promise<void> => {
  const companies = await db.select().from(companiesTable).orderBy(companiesTable.name);
  res.json(companies);
});

router.post("/platform/companies", requirePlatformAdmin, async (req, res): Promise<void> => {
  const parsed = createCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const result = await db.transaction(async (tx) => {
    const existingCompany = await tx
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.slug, data.slug))
      .limit(1);
    if (existingCompany[0]) return { conflict: "Company slug already exists" as const };

    const existingUser = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, data.adminEmail))
      .limit(1);
    if (existingUser[0]) return { conflict: "Admin email already exists" as const };

    const [company] = await tx
      .insert(companiesTable)
      .values({ name: data.name, slug: data.slug })
      .returning();
    const [admin] = await tx
      .insert(usersTable)
      .values({
        name: data.adminName,
        email: data.adminEmail,
        passwordHash: await bcrypt.hash(data.adminPassword, 12),
        role: "admin",
        companyId: company.id,
      })
      .returning();
    return { company, admin };
  });

  if ("conflict" in result) {
    res.status(409).json({ error: result.conflict });
    return;
  }
  res.status(201).json({ company: result.company, admin: publicUser(result.admin) });
});

router.get("/platform/companies/:id/users", requirePlatformAdmin, async (req, res): Promise<void> => {
  const params = companyIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  const company = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.id, params.data.id)).limit(1);
  if (!company[0]) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const users = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role,
    active: usersTable.active, phone: usersTable.phone, licenseNumber: usersTable.licenseNumber,
    companyId: usersTable.companyId, createdAt: usersTable.createdAt, updatedAt: usersTable.updatedAt,
  }).from(usersTable).where(eq(usersTable.companyId, params.data.id)).orderBy(usersTable.name);
  res.json(users);
});

router.post("/platform/companies/:id/users", requirePlatformAdmin, async (req, res): Promise<void> => {
  const params = companyIdParams.safeParse(req.params);
  const parsed = createUserBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.id, params.data.id)).limit(1);
  if (!company[0]) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const duplicate = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, parsed.data.email)).limit(1);
  if (duplicate[0]) {
    res.status(409).json({ error: "User email already exists" });
    return;
  }
  try {
    const [user] = await db.insert(usersTable).values({
      name: parsed.data.name, email: parsed.data.email, role: parsed.data.role,
      phone: parsed.data.phone ?? null, companyId: params.data.id,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
    }).returning();
    logger.info({ userId: user.id, email: user.email, role: user.role, companyId: params.data.id }, "User created (audit)");
    res.status(201).json(publicUser(user));
  } catch (error: any) {
    if (error.code === '23505') {
      logger.warn({ email: parsed.data.email, companyId: params.data.id }, "User creation failed: duplicate email");
      res.status(409).json({ error: "User email already exists" });
      return;
    }
    logger.error({ error, email: parsed.data.email, companyId: params.data.id }, "User creation error");
    throw error;
  }
});

router.patch("/platform/companies/:id", requirePlatformAdmin, async (req, res): Promise<void> => {
  const params = companyIdParams.safeParse(req.params);
  const parsed = updateCompanyBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [company] = await db.update(companiesTable)
    .set({ active: parsed.data.active, updatedAt: new Date() })
    .where(eq(companiesTable.id, params.data.id))
    .returning();
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  logger.info({ companyId: params.data.id, active: parsed.data.active }, "Company status updated (audit)");
  res.json(company);
});

export default router;