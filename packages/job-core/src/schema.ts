import { job_events, jobs } from '@cherrygraph/shared';

export { job_events, jobs };

export type JobRow = typeof jobs.$inferSelect;
export type JobInsert = typeof jobs.$inferInsert;
export type JobEventRow = typeof job_events.$inferSelect;
export type JobEventInsert = typeof job_events.$inferInsert;
