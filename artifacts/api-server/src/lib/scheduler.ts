import { processWorkflowJobs, ProcessJobsResult } from "./worker";
import { logger } from "./logger";

export interface SchedulerOptions {
  enabled?: boolean;
  intervalMs?: number;
  shutdownTimeoutMs?: number;
}

export class InternalWorkerScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isShuttingDown = false;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly shutdownTimeoutMs: number;

  constructor(opts: SchedulerOptions = {}) {
    const envEnabled =
      process.env.ENABLE_INTERNAL_WORKER?.trim().toLowerCase() === "true";
    this.enabled = opts.enabled ?? envEnabled;

    const parsedInterval =
      opts.intervalMs ??
      (process.env.INTERNAL_WORKER_INTERVAL_MS
        ? Number(process.env.INTERNAL_WORKER_INTERVAL_MS)
        : 30000);

    // Enforce bounds: min 5000ms, max 300000ms (5 mins)
    this.intervalMs = Math.max(5000, Math.min(300000, Number.isNaN(parsedInterval) ? 30000 : parsedInterval));
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 10000;
  }

  public isRunning(): boolean {
    return this.timer !== null || this.isProcessing;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public start(): void {
    if (!this.enabled) {
      logger.info("Internal worker scheduler is disabled (ENABLE_INTERNAL_WORKER is not true)");
      return;
    }
    if (this.timer || this.isShuttingDown) {
      return;
    }

    logger.info({ intervalMs: this.intervalMs }, "Starting internal worker scheduler");
    this.scheduleNextTick(0);
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.isShuttingDown) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runTick();
    }, delayMs);
  }

  private async runTick(): Promise<ProcessJobsResult | null> {
    if (this.isProcessing || this.isShuttingDown) {
      return null;
    }

    this.isProcessing = true;
    let result: ProcessJobsResult | null = null;

    try {
      result = await processWorkflowJobs();
      if (result.jobs_seen > 0 || result.recovered_stale_leases > 0) {
        logger.info(
          {
            jobsSeen: result.jobs_seen,
            started: result.started,
            blocked: result.blocked,
            deferredQuietHours: result.deferred_quiet_hours,
            recoveredStaleLeases: result.recovered_stale_leases,
          },
          "Internal worker tick completed",
        );
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Uncaught error in internal worker scheduler tick",
      );
    } finally {
      this.isProcessing = false;
      if (!this.isShuttingDown) {
        this.scheduleNextTick(this.intervalMs);
      }
    }

    return result;
  }

  public async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.isProcessing) {
      logger.info("Internal worker scheduler stopped cleanly");
      return;
    }

    logger.info("Waiting for active internal worker tick to complete...");
    const startTime = Date.now();

    while (this.isProcessing && Date.now() - startTime < this.shutdownTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.isProcessing) {
      logger.warn("Internal worker tick did not resolve before shutdown timeout; database lease recovery will handle uncompleted jobs on next boot");
    } else {
      logger.info("Internal worker scheduler active tick finished; stopped cleanly");
    }
  }
}

export const globalScheduler = new InternalWorkerScheduler();
