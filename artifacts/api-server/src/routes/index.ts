import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsprintRouter from "./leadsprint";
import webhooksRouter from "./webhooks";
import cronRouter from "./cron";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(webhooksRouter);
router.use(cronRouter);
router.use(requireAuth);
router.use(leadsprintRouter);

export default router;
