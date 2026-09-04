import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsprintRouter from "./leadsprint";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsprintRouter);

export default router;
