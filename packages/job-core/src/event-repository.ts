import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { job_events, type JobEventRow } from './schema.js';
import type { JobDatabase } from './repository.js';

export type JobEventCreateInput = {
  id?: string;
  job_id: string;
  event_type: string;
  detail_json?: unknown;
  created_at?: Date;
};

export class JobEventRepository {
  static async create(db: JobDatabase, data: JobEventCreateInput): Promise<JobEventRow> {
    const [created] = await db
      .insert(job_events)
      .values({
        id: data.id ?? randomUUID(),
        job_id: data.job_id,
        event_type: data.event_type,
        ...(data.detail_json !== undefined ? { detail_json: data.detail_json } : {}),
        ...(data.created_at !== undefined ? { created_at: data.created_at } : {}),
      })
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create job event');
    }

    return created;
  }

  static async queryByJobId(db: JobDatabase, jobId: string): Promise<JobEventRow[]> {
    return db
      .select()
      .from(job_events)
      .where(eq(job_events.job_id, jobId))
      .orderBy(asc(job_events.created_at));
  }
}
