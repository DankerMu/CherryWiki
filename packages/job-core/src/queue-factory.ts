import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';

export type BullMQConnection = IORedis;

export class QueueFactory {
  static createQueue<DataType = unknown, ResultType = unknown, NameType extends string = string>(
    name: string,
    connection: BullMQConnection,
    opts: Omit<QueueOptions, 'connection'> = {},
  ): Queue<DataType, ResultType, NameType> {
    return new Queue<DataType, ResultType, NameType>(name, {
      ...opts,
      connection,
    });
  }

  static createWorker<DataType = unknown, ResultType = unknown, NameType extends string = string>(
    name: string,
    processor: Processor<DataType, ResultType, NameType>,
    connection: BullMQConnection,
    opts: Omit<WorkerOptions, 'connection'> = {},
  ): Worker<DataType, ResultType, NameType> {
    return new Worker<DataType, ResultType, NameType>(name, processor, {
      ...opts,
      connection,
    });
  }
}
