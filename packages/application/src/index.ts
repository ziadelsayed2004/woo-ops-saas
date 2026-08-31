export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead-lettered';

export const DURABLE_JOB_TYPES = [
  'webhook.process',
  'sync.initial',
  'sync.incremental',
  'sync.reconcile',
  'bulk.process',
  'export.generate',
  'document.generate',
  'analytics.rebuild',
  'field-mapping.backfill',
  'backup.create',
  'maintenance',
] as const;

export type DurableJobType = (typeof DURABLE_JOB_TYPES)[number];

export type AccountContext = Readonly<{
  accountId: string;
  actorId?: string;
  correlationId: string;
}>;

export type DurableJob = Readonly<{
  id: string;
  accountId: string;
  type: string;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  progress: number;
  payload: unknown;
  cancelRequested: boolean;
  leaseUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type JobExecutionContext = Readonly<{
  accountId: string;
  correlationId: string;
  signal: AbortSignal;
  isCancellationRequested: () => boolean | Promise<boolean>;
  reportProgress: (progress: number) => void | Promise<void>;
}>;

export type JobHandler = (job: DurableJob, context: JobExecutionContext) => void | Promise<void>;

export type JobRepository = {
  claimNextAny: (input: {
    leaseSeconds: number;
    correlationId: string;
  }) => DurableJob | null | Promise<DurableJob | null>;
  recoverExpiredJobsAny: (correlationId: string) => number | Promise<number>;
  complete: (context: AccountContext, id: string) => void | Promise<void>;
  failJob: (context: AccountContext, id: string, error: string) => void | Promise<void>;
  heartbeatJob?: (
    context: AccountContext,
    id: string,
    leaseSeconds: number,
  ) => void | Promise<void>;
  isCancellationRequested?: (context: AccountContext, id: string) => boolean | Promise<boolean>;
  cancelRunningJob?: (context: AccountContext, id: string) => void | Promise<void>;
  updateProgress?: (context: AccountContext, id: string, progress: number) => void | Promise<void>;
};

export type JobRunnerLogger = Readonly<{
  info?: (event: string, details: Readonly<Record<string, unknown>>) => void;
  warn?: (event: string, details: Readonly<Record<string, unknown>>) => void;
  error?: (event: string, details: Readonly<Record<string, unknown>>) => void;
}>;

export type JobRunnerOptions = Readonly<{
  repository: JobRepository;
  concurrency?: number;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  correlationId?: () => string;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  logger?: JobRunnerLogger;
}>;

export type DrainOptions = Readonly<{
  maxJobs?: number;
  signal?: AbortSignal;
}>;

export type StopOptions = Readonly<{
  drain?: boolean;
  timeoutMs?: number;
}>;

export class JobCancelledError extends Error {
  constructor(message = 'JOB_CANCELLED') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

const defaultSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('JOB_RUNNER_ABORTED'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new Error('JOB_RUNNER_ABORTED'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new Error('JOB_RUNNER_OPTION_INVALID');
  }
  return candidate;
};

const errorText = (error: unknown): string => {
  if (error instanceof JobCancelledError) return 'JOB_CANCELLED';
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  return 'JOB_HANDLER_FAILED';
};

/**
 * Infrastructure-independent dispatcher. The persistence adapter owns leases and durable state;
 * this class owns handler registration, bounded execution, heartbeats and lifecycle.
 */
export class InProcessJobRunner {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly repository: JobRepository;
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly correlationId: () => string;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly logger: JobRunnerLogger;
  private running = false;
  private stopRequested = false;
  private active = 0;
  private readonly workers = new Set<Promise<void>>();
  private readonly abortController = new AbortController();

  constructor(options: JobRunnerOptions) {
    this.repository = options.repository;
    this.concurrency = boundedInteger(options.concurrency, 2, 1, 16);
    this.leaseSeconds = boundedInteger(options.leaseSeconds, 60, 5, 3600);
    this.pollIntervalMs = boundedInteger(options.pollIntervalMs, 1000, 10, 60_000);
    this.correlationId = options.correlationId ?? (() => `worker-${Date.now()}`);
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? {};
  }

  register(type: DurableJobType, handler: JobHandler): void {
    if (!DURABLE_JOB_TYPES.includes(type)) throw new Error('JOB_TYPE_NOT_ALLOWED');
    if (this.handlers.has(type)) throw new Error('JOB_HANDLER_ALREADY_REGISTERED');
    this.handlers.set(type, handler);
  }

  registerMany(handlers: Readonly<Partial<Record<DurableJobType, JobHandler>>>): void {
    for (const [type, handler] of Object.entries(handlers)) {
      if (handler) this.register(type as DurableJobType, handler);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get activeCount(): number {
    return this.active;
  }

  get registeredTypes(): readonly string[] {
    return [...this.handlers.keys()].sort();
  }

  start(): void {
    if (this.running) return;
    if (this.stopRequested) throw new Error('JOB_RUNNER_STOPPED');
    this.running = true;
    for (let index = 0; index < this.concurrency; index += 1) {
      const worker = this.loop();
      this.workers.add(worker);
      void worker.then(
        () => this.workers.delete(worker),
        () => this.workers.delete(worker),
      );
    }
    this.logger.info?.('job-runner.started', {
      concurrency: this.concurrency,
      registeredTypes: this.registeredTypes,
    });
  }

  async runOnce(): Promise<boolean> {
    if (this.stopRequested) return false;
    await this.repository.recoverExpiredJobsAny(this.correlationId());
    const job = await this.repository.claimNextAny({
      leaseSeconds: this.leaseSeconds,
      correlationId: this.correlationId(),
    });
    if (!job) return false;
    this.active += 1;
    try {
      await this.execute(job);
    } finally {
      this.active -= 1;
    }
    return true;
  }

  async drain(options: DrainOptions = {}): Promise<number> {
    const maxJobs = boundedInteger(options.maxJobs, 100, 1, 10_000);
    let processed = 0;
    while (!this.stopRequested && processed < maxJobs && !options.signal?.aborted) {
      const claimed = await this.runOnce();
      if (!claimed) break;
      processed += 1;
    }
    return processed;
  }

  async stop(options: StopOptions = {}): Promise<void> {
    if (!this.running && this.workers.size === 0) return;
    this.stopRequested = true;
    this.running = false;
    this.abortController.abort();
    const timeoutMs = boundedInteger(options.timeoutMs, 30_000, 0, 300_000);
    if (options.drain) {
      const deadline = Date.now() + timeoutMs;
      while (this.active > 0 && Date.now() < deadline) {
        await this.sleep(Math.min(25, Math.max(1, deadline - Date.now())));
      }
    }
    await Promise.allSettled([...this.workers]);
    this.logger.info?.('job-runner.stopped', { active: this.active });
  }

  private async loop(): Promise<void> {
    while (this.running && !this.stopRequested) {
      try {
        const claimed = await this.runOnce();
        if (!claimed) await this.sleep(this.pollIntervalMs, this.abortController.signal);
      } catch (error) {
        this.logger.error?.('job-runner.loop-failed', { error: errorText(error) });
        if (!this.stopRequested) {
          try {
            await this.sleep(this.pollIntervalMs, this.abortController.signal);
          } catch {
            // Abort is the normal shutdown path.
          }
        }
      }
    }
  }

  private async execute(job: DurableJob): Promise<void> {
    const context: AccountContext = {
      accountId: job.accountId,
      correlationId: this.correlationId(),
    };
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.repository.failJob(context, job.id, 'JOB_HANDLER_NOT_REGISTERED');
      this.logger.error?.('job.handler-missing', { jobId: job.id, type: job.type });
      return;
    }
    const controller = new AbortController();
    const heartbeatMs = Math.max(1000, Math.floor((this.leaseSeconds * 1000) / 3));
    const heartbeat = setInterval(() => {
      void Promise.resolve(
        this.repository.heartbeatJob?.(context, job.id, this.leaseSeconds),
      ).catch((error: unknown) => {
        controller.abort(error instanceof Error ? error : new Error('JOB_LEASE_LOST'));
      });
    }, heartbeatMs);
    try {
      await handler(job, {
        accountId: job.accountId,
        correlationId: context.correlationId,
        signal: controller.signal,
        isCancellationRequested: async () => {
          const requested = await this.repository.isCancellationRequested?.(context, job.id);
          if (requested) controller.abort(new JobCancelledError());
          return requested ?? false;
        },
        reportProgress: (progress) => this.repository.updateProgress?.(context, job.id, progress),
      });
      if (controller.signal.aborted) throw new JobCancelledError();
      await this.repository.complete(context, job.id);
      this.logger.info?.('job.succeeded', { jobId: job.id, type: job.type });
    } catch (error) {
      if (
        error instanceof JobCancelledError ||
        (error instanceof Error && error.message === 'JOB_CANCELLED') ||
        controller.signal.reason instanceof JobCancelledError
      ) {
        if (this.repository.cancelRunningJob)
          await this.repository.cancelRunningJob(context, job.id);
        else await this.repository.failJob(context, job.id, 'JOB_CANCELLED');
        this.logger.info?.('job.cancelled', { jobId: job.id, type: job.type });
      } else {
        const message = errorText(error);
        await this.repository.failJob(context, job.id, message);
        this.logger.warn?.('job.failed', { jobId: job.id, type: job.type, error: message });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
