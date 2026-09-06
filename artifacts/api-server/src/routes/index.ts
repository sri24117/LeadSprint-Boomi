import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsprintRouter from "./leadsprint";
import webhooksRouter from "./webhooks";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(webhooksRouter);
router.use(requireAuth);
router.use(leadsprintRouter);

export default router;
