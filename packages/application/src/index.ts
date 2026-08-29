export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead-lettered';
export type AccountContext = Readonly<{
  accountId: string;
  actorId?: string;
  correlationId: string;
}>;
export type DurableJob = {
  id: string;
  type: string;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
};
export interface JobRepository {
  claimNext(context: AccountContext): Promise<DurableJob | null>;
  complete(context: AccountContext, id: string): Promise<void>;
}
