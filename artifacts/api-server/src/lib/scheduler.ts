import { logger } from "./logger";
import { db } from "@workspace/db";
import { workflowJobsTable, callsTable } from "@workspace/db";
import { and, eq, lte, asc } from "drizzle-orm";
import { dispatchQueuedCall } from "./callQueue";

export interface SchedulerOptions {
  enabled?: boolean;
  intervalMs?: number;
  shutdownTimeoutMs?: number;
}

export interface TickResult {
  jobs_seen: number;
  started: number;
  blocked: number;
  deferred: number;
  failed: number;
  already_handled: number;
}

/**
 * InternalWorkerScheduler — replaces the need for an external cron service.
 *
 * Enabled by setting ENABLE_INTERNAL_WORKER=true. When active it calls the
 * same dispatchQueuedCall logic that POST /api/cron/process-jobs uses, so
 * the full safety policy gate (consent, suppression, quiet hours, attempt
 * limits, kill switch) is re-evaluated on every tick. This is intentional:
 * a call that was enqueued legally may no longer be legal by the time the
 * worker picks it up.
 *
 * Interval is configurable via INTERNAL_WORKER_INTERVAL_MS (default: 30s).
 * Bounds: min 5s, max 300s. On SIGTERM/SIGINT the active tick is allowed
 * to finish before the process exits (shutdownTimeoutMs, default: 10s).
 */
export class InternalWorkerScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isShuttingDown = false;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly shutdownTimeoutMs: number;

  constructor(opts: SchedulerOptions = {}) {
    const envEnabled =
      process.env["ENABLE_INTERNAL_WORKER"]?.trim().toLowerCase() === "true";
    this.enabled = opts.enabled ?? envEnabled;

    const parsedInterval =
      opts.intervalMs ??
      (process.env["INTERNAL_WORKER_INTERVAL_MS"]
        ? Number(process.env["INTERNAL_WORKER_INTERVAL_MS"])
        : 30000);

    // Enforce bounds: min 5s, max 300s
    this.intervalMs = Math.max(
      5000,
      Math.min(300000, Number.isNaN(parsedInterval) ? 30000 : parsedInterval),
    );
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
      logger.info(
        "Internal worker scheduler is disabled (set ENABLE_INTERNAL_WORKER=true to activate)",
      );
      return;
    }
    if (this.timer || this.isShuttingDown) return;

    logger.info(
      { intervalMs: this.intervalMs },
      "Internal worker scheduler started — queued calls will be dispatched automatically",
    );
    this.scheduleNextTick(0);
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.isShuttingDown) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runTick();
    }, delayMs);
  }

  private async runTick(): Promise<TickResult | null> {
    if (this.isProcessing || this.isShuttingDown) return null;

    this.isProcessing = true;
    let result: TickResult | null = null;

    try {
      result = await processQueuedJobs();
      if (result.jobs_seen > 0) {
        logger.info(
          {
            jobsSeen: result.jobs_seen,
            started: result.started,
            blocked: result.blocked,
            deferred: result.deferred,
            failed: result.failed,
            alreadyHandled: result.already_handled,
          },
          "Worker tick completed",
        );
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Uncaught error in internal worker tick",
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

    logger.info("Waiting for active worker tick to finish before shutdown...");
    const startTime = Date.now();
    while (
      this.isProcessing &&
      Date.now() - startTime < this.shutdownTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.isProcessing) {
      logger.warn(
        "Worker tick did not finish within shutdown timeout; database will recover stale jobs on next boot",
      );
    } else {
      logger.info("Worker tick finished; scheduler stopped cleanly");
    }
  }
}

const MAX_JOB_ATTEMPTS = 5;

/**
 * Drains the workflow_jobs queue — same logic as POST /api/cron/process-jobs
 * but callable directly without HTTP so the internal scheduler can use it.
 */
async function processQueuedJobs(): Promise<TickResult> {
  const now = new Date();
  const jobs = await db
    .select()
    .from(workflowJobsTable)
    .where(
      and(
        eq(workflowJobsTable.type, "initiate_call"),
        eq(workflowJobsTable.status, "queued"),
        lte(workflowJobsTable.availableAt, now),
      ),
    )
    .orderBy(asc(workflowJobsTable.availableAt))
    .limit(25);

  let started = 0;
  let blocked = 0;
  let deferred = 0;
  let failed = 0;
  let already_handled = 0;

  for (const job of jobs) {
    const [call] = await db
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.businessId, job.businessId),
          eq(callsTable.idempotencyKey, job.idempotencyKey),
        ),
      )
      .limit(1);

    if (!call) {
      await db
        .update(workflowJobsTable)
        .set({
          status: "failed",
          attempts: job.attempts + 1,
          lastError: "Call row not found for idempotency key",
        })
        .where(eq(workflowJobsTable.id, job.id));
      failed += 1;
      continue;
    }

    const result = await dispatchQueuedCall({
      businessId: job.businessId,
      callId: call.id,
    });
    const nextAttempts = job.attempts + 1;

    switch (result.outcome) {
      case "started":
        started += 1;
        await db
          .update(workflowJobsTable)
          .set({ status: "completed" })
          .where(eq(workflowJobsTable.id, job.id));
        break;

      case "already_handled":
        already_handled += 1;
        await db
          .update(workflowJobsTable)
          .set({ status: "completed" })
          .where(eq(workflowJobsTable.id, job.id));
        break;

      case "setup_incomplete":
      case "provider_not_configured":
        // Leave queued — workspace is still being configured
        deferred += 1;
        await db
          .update(workflowJobsTable)
          .set({
            availableAt: new Date(now.getTime() + 15 * 60 * 1000),
            lastError: result.message,
          })
          .where(eq(workflowJobsTable.id, job.id));
        break;

      case "policy_blocked":
        blocked += 1;
        if (result.retryable && nextAttempts < MAX_JOB_ATTEMPTS) {
          // Quiet hours resolve on their own — check again in 30 min
          await db
            .update(workflowJobsTable)
            .set({
              attempts: nextAttempts,
              availableAt: new Date(now.getTime() + 30 * 60 * 1000),
              lastError: result.message,
            })
            .where(eq(workflowJobsTable.id, job.id));
        } else {
          await db
            .update(workflowJobsTable)
            .set({
              status: "failed",
              attempts: nextAttempts,
              lastError: result.message,
            })
            .where(eq(workflowJobsTable.id, job.id));
        }
        break;

      case "provider_uncertain":
      default:
        failed += 1;
        if (nextAttempts < MAX_JOB_ATTEMPTS) {
          // Exponential backoff: 10 min, 20 min, 40 min...
          const backoffMs = Math.min(
            60 * 60 * 1000,
            Math.pow(2, nextAttempts) * 5 * 60 * 1000,
          );
          await db
            .update(workflowJobsTable)
            .set({
              attempts: nextAttempts,
              availableAt: new Date(now.getTime() + backoffMs),
              lastError: result.message,
            })
            .where(eq(workflowJobsTable.id, job.id));
        } else {
          await db
            .update(workflowJobsTable)
            .set({
              status: "failed",
              attempts: nextAttempts,
              lastError: result.message,
            })
            .where(eq(workflowJobsTable.id, job.id));
        }
        break;
    }
  }

  return {
    jobs_seen: jobs.length,
    started,
    blocked,
    deferred,
    failed,
    already_handled,
  };
}

export const globalScheduler = new InternalWorkerScheduler();
