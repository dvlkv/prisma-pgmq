export type Task = Record<string, unknown>;

// Result column spec accepted by Prisma's raw lane: a codec id, or a codec id with nullability
type RowSpec = Readonly<Record<string, string | { readonly codecId: string; readonly nullable?: boolean }>>;

// Minimal shape of the statement builder returned by `db.raw.sql`
export interface PgmqRawStatement {
  returnsRow(spec: RowSpec): { build(): unknown };
  affectedCount(): { build(): unknown };
}

// Minimal shape of a Prisma runtime, connection or transaction that can run a raw plan
export interface PgmqQueryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(plan: any): PromiseLike<unknown[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(plan: any): PromiseLike<unknown>;
}

// Minimal interface for a Prisma 8 Postgres client (`postgres<Contract>(...)`)
export interface PgmqClient {
  readonly raw: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly sql: (strings: TemplateStringsArray, ...values: any[]) => PgmqRawStatement;
  };
  runtime(): PgmqQueryable;
}

// Binds a Prisma 8 transaction to the client, so pgmq calls run inside that transaction
export function inTransaction(db: PgmqClient, tx: PgmqQueryable): PgmqClient {
  return { raw: db.raw, runtime: () => tx };
}

// Message record type based on PGMQ documentation
export interface MessageRecord {
  msg_id: bigint;
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

const messageRecordSpec = {
  msg_id: 'pg/int8@1',
  read_ct: 'pg/int4@1',
  enqueued_at: 'pg/timestamptz-date@1',
  vt: 'pg/timestamptz-date@1',
  message: 'pg/jsonb@1',
} as const;

const queueMetricsSpec = {
  queue_name: 'pg/text@1',
  queue_length: 'pg/int8number@1',
  newest_msg_age_sec: { codecId: 'pg/int4@1', nullable: true },
  oldest_msg_age_sec: { codecId: 'pg/int4@1', nullable: true },
  total_messages: 'pg/int8number@1',
  scrape_time: 'pg/timestamptz-date@1',
} as const;

const queueInfoSpec = {
  queue_name: 'pg/text@1',
  created_at: 'pg/timestamptz-date@1',
  is_partitioned: 'pg/bool@1',
  is_unlogged: 'pg/bool@1',
} as const;

async function queryRows<T>(tx: PgmqClient, statement: PgmqRawStatement, spec: RowSpec): Promise<T[]> {
    return (await tx.runtime().query(statement.returnsRow(spec).build())) as T[];
}

async function queryFirst<T>(tx: PgmqClient, statement: PgmqRawStatement, spec: RowSpec, fn: string): Promise<T> {
    const firstResult = (await queryRows<T>(tx, statement, spec))[0];
    if (!firstResult) {
        throw new Error(`No result returned from pgmq.${fn}`);
    }
    return firstResult;
}

async function execute(tx: PgmqClient, statement: PgmqRawStatement): Promise<void> {
    await tx.runtime().execute(statement.affectedCount().build());
}

// Postgres array literal, bound as text and cast to bigint[] in SQL
function msgIdArray(msgIds: (bigint | number)[]): string {
    return `{${msgIds.map(id => BigInt(id).toString()).join(',')}}`;
}

// Sending Messages

export async function send(tx: PgmqClient, queueName: string, msg: Task, delay?: number | Date): Promise<bigint> {
    const payload = JSON.stringify(msg);
    let statement: PgmqRawStatement;
    if (delay instanceof Date) {
        statement = tx.raw.sql`SELECT pgmq.send(${queueName}, ${payload}::jsonb, ${delay.toISOString()}::timestamptz) AS send`;
    } else if (delay) {
        statement = tx.raw.sql`SELECT pgmq.send(${queueName}, ${payload}::jsonb, ${delay}::integer) AS send`;
    } else {
        statement = tx.raw.sql`SELECT pgmq.send(${queueName}, ${payload}::jsonb) AS send`;
    }
    const result = await queryFirst<{ send: bigint }>(tx, statement, { send: 'pg/int8@1' }, 'send');
    return result.send;
}

export async function sendBatch(tx: PgmqClient, queueName: string, msgs: Task[], delay?: number | Date): Promise<bigint[]> {
    const payload = JSON.stringify(msgs);
    let statement: PgmqRawStatement;
    if (delay instanceof Date) {
        statement = tx.raw.sql`SELECT pgmq.send_batch(${queueName}, ARRAY(SELECT jsonb_array_elements(${payload}::jsonb)), ${delay.toISOString()}::timestamptz) AS send_batch`;
    } else if (delay) {
        statement = tx.raw.sql`SELECT pgmq.send_batch(${queueName}, ARRAY(SELECT jsonb_array_elements(${payload}::jsonb)), ${delay}::integer) AS send_batch`;
    } else {
        statement = tx.raw.sql`SELECT pgmq.send_batch(${queueName}, ARRAY(SELECT jsonb_array_elements(${payload}::jsonb))) AS send_batch`;
    }
    const result = await queryRows<{ send_batch: bigint }>(tx, statement, { send_batch: 'pg/int8@1' });
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
    return queryRows<MessageRecord>(
        tx,
        tx.raw.sql`SELECT msg_id, read_ct, enqueued_at, vt, message FROM pgmq.read(${queueName}, ${vt}::integer, ${qty}::integer, ${JSON.stringify(conditional)}::jsonb)`,
        messageRecordSpec
    );
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
    return queryRows<MessageRecord>(
        tx,
        tx.raw.sql`SELECT msg_id, read_ct, enqueued_at, vt, message FROM pgmq.read_with_poll(${queueName}, ${vt}::integer, ${qty}::integer, ${maxPollSeconds}::integer, ${pollIntervalMs}::integer, ${JSON.stringify(conditional)}::jsonb)`,
        messageRecordSpec
    );
}

export function pop(tx: PgmqClient, queueName: string): Promise<MessageRecord[]> {
    return queryRows<MessageRecord>(
        tx,
        tx.raw.sql`SELECT msg_id, read_ct, enqueued_at, vt, message FROM pgmq.pop(${queueName})`,
        messageRecordSpec
    );
}

// Deleting/Archiving Messages

export async function deleteMessage(tx: PgmqClient, queueName: string, msgId: bigint | number): Promise<boolean> {
    const result = await queryFirst<{ delete: boolean }>(
        tx,
        tx.raw.sql`SELECT pgmq.delete(${queueName}, ${BigInt(msgId).toString()}::bigint) AS delete`,
        { delete: 'pg/bool@1' },
        'delete'
    );
    return result.delete;
}

export async function deleteBatch(tx: PgmqClient, queueName: string, msgIds: (bigint | number)[]): Promise<bigint[]> {
    const result = await queryRows<{ delete: bigint }>(
        tx,
        tx.raw.sql`SELECT pgmq.delete(${queueName}, ${msgIdArray(msgIds)}::bigint[]) AS delete`,
        { delete: 'pg/int8@1' }
    );
    return result.map(a => a.delete);
}

export async function purgeQueue(tx: PgmqClient, queueName: string): Promise<number> {
    const result = await queryFirst<{ purge_queue: number }>(
        tx,
        tx.raw.sql`SELECT pgmq.purge_queue(${queueName}) AS purge_queue`,
        { purge_queue: 'pg/int8number@1' },
        'purge_queue'
    );
    return result.purge_queue;
}

export async function archive(tx: PgmqClient, queueName: string, msgId: bigint | number): Promise<boolean> {
    const result = await queryFirst<{ archive: boolean }>(
        tx,
        tx.raw.sql`SELECT pgmq.archive(${queueName}, ${BigInt(msgId).toString()}::bigint) AS archive`,
        { archive: 'pg/bool@1' },
        'archive'
    );
    return result.archive;
}

export async function archiveBatch(tx: PgmqClient, queueName: string, msgIds: (bigint | number)[]): Promise<bigint[]> {
    const result = await queryRows<{ archive: bigint }>(
        tx,
        tx.raw.sql`SELECT pgmq.archive(${queueName}, ${msgIdArray(msgIds)}::bigint[]) AS archive`,
        { archive: 'pg/int8@1' }
    );
    return result.map(a => a.archive);
}

// Queue Management

export async function createQueue(tx: PgmqClient, queueName: string): Promise<void> {
    await execute(tx, tx.raw.sql`SELECT pgmq.create(${queueName})`);
}

export async function createPartitionedQueue(
    tx: PgmqClient,
    queueName: string,
    partitionInterval: string = '10000',
    retentionInterval: string = '100000'
): Promise<void> {
    await execute(tx, tx.raw.sql`SELECT pgmq.create_partitioned(${queueName}, ${partitionInterval}, ${retentionInterval})`);
}

export async function createUnloggedQueue(tx: PgmqClient, queueName: string): Promise<void> {
    await execute(tx, tx.raw.sql`SELECT pgmq.create_unlogged(${queueName})`);
}

export async function detachArchive(tx: PgmqClient, queueName: string): Promise<void> {
    await execute(tx, tx.raw.sql`SELECT pgmq.detach_archive(${queueName})`);
}

export async function dropQueue(tx: PgmqClient, queueName: string): Promise<boolean> {
    const result = await queryFirst<{ drop_queue: boolean }>(
        tx,
        tx.raw.sql`SELECT pgmq.drop_queue(${queueName}) AS drop_queue`,
        { drop_queue: 'pg/bool@1' },
        'drop_queue'
    );
    return result.drop_queue;
}

// Utilities

export async function setVt(
    tx: PgmqClient,
    queueName: string,
    msgId: bigint | number,
    vtOffset: number
): Promise<MessageRecord> {
    return queryFirst<MessageRecord>(
        tx,
        tx.raw.sql`SELECT msg_id, read_ct, enqueued_at, vt, message FROM pgmq.set_vt(${queueName}, ${BigInt(msgId).toString()}::bigint, ${vtOffset}::integer)`,
        messageRecordSpec,
        'set_vt'
    );
}

export function listQueues(tx: PgmqClient): Promise<QueueInfo[]> {
    return queryRows<QueueInfo>(
        tx,
        tx.raw.sql`SELECT queue_name, created_at, is_partitioned, is_unlogged FROM pgmq.list_queues()`,
        queueInfoSpec
    );
}

export function metrics(tx: PgmqClient, queueName: string): Promise<QueueMetrics> {
    return queryFirst<QueueMetrics>(
        tx,
        tx.raw.sql`SELECT queue_name, queue_length, newest_msg_age_sec, oldest_msg_age_sec, total_messages, scrape_time FROM pgmq.metrics(${queueName})`,
        queueMetricsSpec,
        'metrics'
    );
}

export function metricsAll(tx: PgmqClient): Promise<QueueMetrics[]> {
    return queryRows<QueueMetrics>(
        tx,
        tx.raw.sql`SELECT queue_name, queue_length, newest_msg_age_sec, oldest_msg_age_sec, total_messages, scrape_time FROM pgmq.metrics_all()`,
        queueMetricsSpec
    );
}
