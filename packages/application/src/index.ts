export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead-lettered';
export type DurableJob = {
  id: string;
  type: string;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
};
export interface JobRepository {
  claimNext(): Promise<DurableJob | null>;
  complete(id: string): Promise<void>;
}
