import { Sql, sqltag as sql } from '@prisma/client/runtime/client';

export type Task = Record<string, unknown>;

// Minimal interface for Prisma client or transaction client
export interface PgmqClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRaw<T = unknown>(query: TemplateStringsArray | Sql, ...values: any[]): Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $executeRaw(query: TemplateStringsArray | Sql, ...values: any[]): Promise<number>;
}

// Message record type based on PGMQ documentation
export interface MessageRecord {
  msg_id: number;
  read_ct: number;
  enqueued_at: Date;
  vt: Date;
  message: Task;
}

// Queue metrics type
export interface QueueMetrics {
  queue_name: string;
  queue_length: number;
  newest_msg_age_sec: number | null;
  oldest_msg_age_sec: number | null;
  total_messages: number;
  scrape_time: Date;
}

// Queue info type
export interface QueueInfo {
  queue_name: string;
  created_at: Date;
  is_partitioned: boolean;
  is_unlogged: boolean;
}

export async function send(tx: PgmqClient, queueName: string, msg: Task, delay?: number | Date): Promise<number> {
    const delayRepr = typeof delay === 'number' ? sql`${delay}::integer` : sql`${delay}`;
    const delaySql = delay ? sql`, ${delayRepr}` : sql``;
    const result: { send: number }[] = await tx.$queryRaw`SELECT pgmq.send(${queueName}, ${msg}${delaySql})`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.send');
    }
    return firstResult.send;
}

export async function sendBatch(tx: PgmqClient, queueName: string, msgs: Task[], delay?: number | Date): Promise<number[]> {
    const delayRepr = typeof delay === 'number' ? sql`${delay}::integer` : sql`${delay}`;
    const delaySql = delay ? sql`, ${delayRepr}` : sql``;
    const result: { send_batch: number }[] = await tx.$queryRaw`SELECT pgmq.send_batch(${queueName}, ${msgs}${delaySql})`;
    return result.map(a => a.send_batch);
}

// Reading Messages

export function read(
    tx: PgmqClient,
    queueName: string,
    vt: number,
    qty: number = 1,
    conditional: Task = {}
): Promise<MessageRecord[]> {
    return tx.$queryRaw`SELECT * FROM pgmq.read(${queueName}, ${vt}::integer, ${qty}::integer, ${conditional})` as Promise<MessageRecord[]>;
}

export function readWithPoll(
    tx: PgmqClient,
    queueName: string,
    vt: number,
    qty: number = 1,
    maxPollSeconds: number = 5,
    pollIntervalMs: number = 100,
    conditional: Task = {}
): Promise<MessageRecord[]> {
    return tx.$queryRaw`SELECT * FROM pgmq.read_with_poll(${queueName}, ${vt}::integer, ${qty}::integer, ${maxPollSeconds}::integer, ${pollIntervalMs}::integer, ${conditional})` as Promise<MessageRecord[]>;
}

export function pop(tx: PgmqClient, queueName: string): Promise<MessageRecord[]> {
    return tx.$queryRaw`SELECT * FROM pgmq.pop(${queueName})` as Promise<MessageRecord[]>;
}

// Deleting/Archiving Messages

export async function deleteMessage(tx: PgmqClient, queueName: string, msgId: number): Promise<boolean> {
    const result: { delete: boolean }[] = await tx.$queryRaw`SELECT pgmq.delete(${queueName}, ${msgId}::integer)`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.delete');
    }
    return firstResult.delete;
}

export async function deleteBatch(tx: PgmqClient, queueName: string, msgIds: number[]): Promise<number[]> {
    const result: { delete: number }[] = await tx.$queryRaw`SELECT pgmq.delete(${queueName}, ${msgIds}::integer[])`;
    return result.map(a => a.delete);
}

export async function purgeQueue(tx: PgmqClient, queueName: string): Promise<number> {
    const result: { purge_queue: number }[] = await tx.$queryRaw`SELECT pgmq.purge_queue(${queueName})`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.purge_queue');
    }
    return firstResult.purge_queue;
}

export async function archive(tx: PgmqClient, queueName: string, msgId: number): Promise<boolean> {
    const result: { archive: boolean }[] = await tx.$queryRaw`SELECT pgmq.archive(${queueName}, ${msgId}::integer)`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.archive');
    }
    return firstResult.archive;
}

export async function archiveBatch(tx: PgmqClient, queueName: string, msgIds: number[]): Promise<number[]> {
    const result: { archive: number }[] = await tx.$queryRaw`SELECT pgmq.archive(${queueName}, ${msgIds}::integer[])`;
    return result.map(a => a.archive);
}

// Queue Management

export async function createQueue(tx: PgmqClient, queueName: string): Promise<void> {
    await tx.$executeRaw`SELECT pgmq.create(${queueName})`;
}

export async function createPartitionedQueue(
    tx: PgmqClient,
    queueName: string,
    partitionInterval: string = '10000',
    retentionInterval: string = '100000'
): Promise<void> {
    await tx.$executeRaw`SELECT pgmq.create_partitioned(${queueName}, ${partitionInterval}, ${retentionInterval})`;
}

export async function createUnloggedQueue(tx: PgmqClient, queueName: string): Promise<void> {
    await tx.$executeRaw`SELECT pgmq.create_unlogged(${queueName})`;
}

export async function detachArchive(tx: PgmqClient, queueName: string): Promise<void> {
    await tx.$executeRaw`SELECT pgmq.detach_archive(${queueName})`;
}

export async function dropQueue(tx: PgmqClient, queueName: string): Promise<boolean> {
    const result: { drop_queue: boolean }[] = await tx.$queryRaw`SELECT pgmq.drop_queue(${queueName})`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.drop_queue');
    }
    return firstResult.drop_queue;
}

// Utilities

export async function setVt(
    tx: PgmqClient,
    queueName: string,
    msgId: number,
    vtOffset: number
): Promise<MessageRecord> {
    const result: MessageRecord[] = await tx.$queryRaw`SELECT * FROM pgmq.set_vt(${queueName}, ${msgId}::integer, ${vtOffset}::integer)`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.set_vt');
    }
    return firstResult;
}

export async function listQueues(tx: PgmqClient): Promise<QueueInfo[]> {
    const result: QueueInfo[] = await tx.$queryRaw`SELECT * FROM pgmq.list_queues()`;
    return result;
}

export async function metrics(tx: PgmqClient, queueName: string): Promise<QueueMetrics> {
    const result: QueueMetrics[] = await tx.$queryRaw`SELECT * FROM pgmq.metrics(${queueName})`;
    const firstResult = result[0];
    if (!firstResult) {
        throw new Error('No result returned from pgmq.metrics');
    }
    return firstResult;
}

export async function metricsAll(tx: PgmqClient): Promise<QueueMetrics[]> {
    const result: QueueMetrics[] = await tx.$queryRaw`SELECT * FROM pgmq.metrics_all()`;
    return result;
}
