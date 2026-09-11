import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import fleetRouter from "./fleet.js";
import vehiclesRouter from "./vehicles.js";
import workOrdersRouter from "./work-orders.js";
import storageRouter from "./storage.js";
import checklistsRouter from "./checklists.js";
import defectsRouter from "./defects.js";
import complianceRouter from "./compliance.js";
import notificationsRouter from "./notifications.js";
import dashboardRouter from "./dashboard.js";
import reportsRouter from "./reports.js";
import platformRouter from "./platform.js";
import customersRouter from "./customers.js";
import estimatesRouter from "./estimates.js";
import { requireOperationalAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(platformRouter);
// Everything below is tenant-facing. Platform administrators have no implicit
// tenant and therefore cannot reach these routes without future impersonation.
router.use(requireOperationalAuth);
router.use(customersRouter);
router.use(estimatesRouter);
router.use(fleetRouter);
router.use(vehiclesRouter);
router.use(workOrdersRouter);
router.use(checklistsRouter);
router.use(defectsRouter);
router.use(complianceRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(storageRouter);

export default router;
