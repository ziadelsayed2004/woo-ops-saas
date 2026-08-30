import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InProcessJobRunner, JobCancelledError } from '../dist/index.js';

const makeJob = (overrides = {}) => ({
  id: randomUUID(),
  accountId: 'account-a',
  type: 'maintenance',
  idempotencyKey: randomUUID(),
  status: 'queued',
  attempts: 0,
  maxAttempts: 2,
  progress: 0,
  payload: {},
  cancelRequested: false,
  leaseUntil: new Date(Date.now() + 60_000).toISOString(),
  lastError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const fakeRepository = (jobs) => {
  const state = jobs.map((job) => ({ ...job }));
  const calls = [];
  return {
    state,
    calls,
    claimNextAny: () => {
      const job = state.find((candidate) => candidate.status === 'queued');
      if (!job) return null;
      job.status = 'running';
      job.attempts += 1;
      calls.push(['claim', job.id]);
      return { ...job };
    },
    recoverExpiredJobsAny: () => 0,
    complete: (_context, id) => {
      const job = state.find((candidate) => candidate.id === id);
      assert.ok(job);
      job.status = 'succeeded';
      job.progress = 100;
      calls.push(['complete', id]);
    },
    failJob: (_context, id, error) => {
      const job = state.find((candidate) => candidate.id === id);
      assert.ok(job);
      job.lastError = error;
      job.status = job.attempts >= job.maxAttempts ? 'dead-lettered' : 'queued';
      calls.push(['fail', id, error]);
    },
    heartbeatJob: () => undefined,
    isCancellationRequested: (_context, id) =>
      Boolean(state.find((candidate) => candidate.id === id)?.cancelRequested),
    cancelRunningJob: (_context, id) => {
      const job = state.find((candidate) => candidate.id === id);
      assert.ok(job);
      job.status = 'failed';
      job.lastError = 'JOB_CANCELLED';
      calls.push(['cancel', id]);
    },
    updateProgress: (_context, id, progress) => {
      const job = state.find((candidate) => candidate.id === id);
      assert.ok(job);
      job.progress = progress;
    },
  };
};

test('runner enforces typed registration, bounded execution and progress', async () => {
  const repository = fakeRepository([makeJob(), makeJob()]);
  const runner = new InProcessJobRunner({ repository, concurrency: 2, pollIntervalMs: 10 });
  assert.throws(() => runner.register('not-a-job-type', () => undefined), /JOB_TYPE_NOT_ALLOWED/);
  let active = 0;
  let maximum = 0;
  runner.register('maintenance', async (_job, context) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await context.reportProgress(50);
    active -= 1;
  });
  await Promise.all([runner.runOnce(), runner.runOnce()]);
  assert.equal(maximum, 2);
  assert.deepEqual(
    repository.state.map((job) => job.status),
    ['succeeded', 'succeeded'],
  );
  assert.equal(
    repository.state.every((job) => job.progress === 100),
    true,
  );
});

test('runner retries handler failures and dead-letters after the declared attempts', async () => {
  const repository = fakeRepository([makeJob({ maxAttempts: 2 })]);
  const runner = new InProcessJobRunner({ repository });
  let executions = 0;
  runner.register('maintenance', () => {
    executions += 1;
    if (executions === 1) throw new Error('temporary failure');
  });
  await runner.runOnce();
  assert.equal(repository.state[0].status, 'queued');
  assert.equal(repository.state[0].lastError, 'temporary failure');
  await runner.runOnce();
  assert.equal(repository.state[0].status, 'succeeded');

  const poisonRepository = fakeRepository([makeJob({ maxAttempts: 1 })]);
  const poisonRunner = new InProcessJobRunner({ repository: poisonRepository });
  poisonRunner.register('maintenance', () => {
    throw new Error('poison');
  });
  await poisonRunner.runOnce();
  assert.equal(poisonRepository.state[0].status, 'dead-lettered');
  assert.equal(poisonRepository.state[0].lastError, 'poison');
});

test('runner handles cancellation and stop/drain lifecycle', async () => {
  const job = makeJob({ cancelRequested: true });
  const repository = fakeRepository([job]);
  const runner = new InProcessJobRunner({ repository });
  runner.register('maintenance', async (_job, context) => {
    assert.equal(await context.isCancellationRequested(), true);
    assert.equal(context.signal.aborted, true);
  });
  await runner.runOnce();
  assert.equal(repository.state[0].status, 'failed');
  assert.equal(repository.state[0].lastError, 'JOB_CANCELLED');
  assert.equal(runner.activeCount, 0);
  await runner.stop({ drain: true, timeoutMs: 10 });
  assert.equal(runner.isRunning, false);
});

test('missing handlers become bounded failures instead of successful work', async () => {
  const repository = fakeRepository([makeJob({ type: 'sync.incremental', maxAttempts: 1 })]);
  const runner = new InProcessJobRunner({ repository });
  await runner.runOnce();
  assert.equal(repository.state[0].status, 'dead-lettered');
  assert.equal(repository.state[0].lastError, 'JOB_HANDLER_NOT_REGISTERED');
  assert.equal(
    repository.calls.some((call) => call[0] === 'complete'),
    false,
  );
  assert.equal(new JobCancelledError().message, 'JOB_CANCELLED');
});
