# Prisma PGMQ

A TypeScript library that provides type-safe methods for PostgreSQL Message Queue (PGMQ) operations in your Prisma-based applications.

## Features

- 🔒 **Type-safe**: Full TypeScript support with proper type definitions
- 📦 **Easy to use**: Simple API with functional methods
- 🔌 **Prisma Integration**: Seamless integration with your existing Prisma setup

## Compatibility

| prisma-pgmq | Prisma ORM | Node.js   |
|-------------|------------|-----------|
| v2.x        | v7+        | >= 20.19  |
| v1.x        | v5 / v6    | >= 16     |

## Installation

```bash
npm install prisma-pgmq
# or
pnpm add prisma-pgmq
# or
yarn add prisma-pgmq
```

### Prerequisites

- PostgreSQL database with the PGMQ extension installed
- Prisma Client v7.0.0 or higher
- Node.js 20.19+

> **Enabling the PGMQ extension via Prisma**
>
> You can manage PostgreSQL extensions (including PGMQ) directly in your Prisma schema using the `postgresqlExtensions` preview feature. Add the extension to your `datasource` block in `schema.prisma`:
>
> ```prisma
> generator client {
>   provider = "prisma-client"
>   output   = "./generated/prisma/client"
> }
>
> datasource db {
>   provider   = "postgresql"
>   extensions = [pgmq]
> }
> ```
>
> For more details, see the [Prisma documentation on PostgreSQL extensions](https://www.prisma.io/docs/orm/prisma-schema/postgresql-extensions).

## Quick Start

### Functional API

```typescript
import { PrismaClient } from './generated/prisma/client';
import { pgmq } from 'prisma-pgmq';

const prisma = new PrismaClient();

// Create a queue
await pgmq.createQueue(prisma, 'my-work-queue');

// Send a message
await pgmq.send(prisma, 'my-work-queue', {
  userId: 123,
  action: 'send-email',
  email: 'user@example.com'
});
```

## API Reference

### Message Operations

#### `send(tx, queueName, message, delay?)`
Send a single message to a queue.

```typescript
const msgId = await pgmq.send(tx, 'my-queue', { data: 'hello' });

// Send with delay (seconds)
const msgId = await pgmq.send(tx, 'my-queue', { data: 'hello' }, 30);

// Send with specific time
const msgId = await pgmq.send(
  tx, 
  'my-queue', 
  { data: 'hello' }, 
  new Date('2024-01-01T10:00:00Z')
);
```

#### `sendBatch(tx, queueName, messages, delay?)`
Send multiple messages to a queue in a single operation.

```typescript
const msgIds = await pgmq.sendBatch(tx, 'my-queue', [
  { id: 1, data: 'message 1' },
  { id: 2, data: 'message 2' },
  { id: 3, data: 'message 3' }
]);
```

#### `read(tx, queueName, vt, qty?, conditional?)`
Read messages from a queue with visibility timeout.

```typescript
// Read up to 5 messages with 30 second visibility timeout
const messages = await pgmq.read(tx, 'my-queue', 30, 5);

// Read with conditional filtering
const messages = await pgmq.read(tx, 'my-queue', 30, 5, { priority: 'high' });
```

#### `readWithPoll(tx, queueName, vt, qty?, maxPollSeconds?, pollIntervalMs?, conditional?)`
Read messages with polling (wait for messages if none available).

```typescript
// Poll for up to 10 seconds, checking every 500ms
const messages = await pgmq.readWithPoll(tx, 'my-queue', 30, 1, 10, 500);
```

#### `pop(tx, queueName)`
Read and immediately delete a message (atomic operation).

```typescript
const messages = await pgmq.pop(tx, 'my-queue');
```

### Message Management

#### `deleteMessage(tx, queueName, msgId)`
Delete a specific message.

```typescript
const deleted = await pgmq.deleteMessage(tx, 'my-queue', 123);
```

#### `deleteBatch(tx, queueName, msgIds)`
Delete multiple messages.

```typescript
const deletedIds = await pgmq.deleteBatch(tx, 'my-queue', [123, 124, 125]);
```

#### `archive(tx, queueName, msgId)`
Archive a message (move to archive table).

```typescript
const archived = await pgmq.archive(tx, 'my-queue', 123);
```

#### `archiveBatch(tx, queueName, msgIds)`
Archive multiple messages.

```typescript
const archivedIds = await pgmq.archiveBatch(tx, 'my-queue', [123, 124, 125]);
```

### Queue Management

#### `createQueue(tx, queueName)`
Create a new queue.

```typescript
await pgmq.createQueue(tx, 'my-new-queue');
```

#### `createPartitionedQueue(tx, queueName, partitionInterval?, retentionInterval?)`
Create a partitioned queue for high-throughput scenarios.

```typescript
await pgmq.createPartitionedQueue(tx, 'high-volume-queue', '10000', '100000');
```

#### `createUnloggedQueue(tx, queueName)`
Create an unlogged queue (better performance, less durability).

```typescript
await pgmq.createUnloggedQueue(tx, 'temp-queue');
```

#### `dropQueue(tx, queueName)`
Delete a queue and all its messages.

```typescript
const dropped = await pgmq.dropQueue(tx, 'old-queue');
```

#### `purgeQueue(tx, queueName)`
Remove all messages from a queue.

```typescript
const messageCount = await pgmq.purgeQueue(tx, 'my-queue');
```

### Utilities

#### `setVt(tx, queueName, msgId, vtOffset)`
Set visibility timeout for a specific message.

```typescript
const message = await pgmq.setVt(tx, 'my-queue', 123, 60); // 60 seconds
```

#### `listQueues(tx)`
Get information about all queues.

```typescript
const queues = await pgmq.listQueues(tx);
console.log(queues); // [{ queue_name: 'my-queue', created_at: ..., is_partitioned: false }]
```

#### `metrics(tx, queueName)`
Get metrics for a specific queue.

```typescript
const metrics = await pgmq.metrics(tx, 'my-queue');
console.log(metrics);
// {
//   queue_name: 'my-queue',
//   queue_length: 5,
//   newest_msg_age_sec: 10,
//   oldest_msg_age_sec: 300,
//   total_messages: 1000,
//   scrape_time: 2024-01-01T10:00:00.000Z
// }
```

#### `metricsAll(tx)`
Get metrics for all queues.

```typescript
const allMetrics = await pgmq.metricsAll(tx);
```

## Type Definitions

### `Task`
```typescript
type Task = Record<string, unknown>;
```

### `MessageRecord`
```typescript
interface MessageRecord {
  msg_id: number;
  read_ct: number;
  enqueued_at: Date;
  vt: Date;
  message: Task;
}
```

### `QueueMetrics`
```typescript
interface QueueMetrics {
  queue_name: string;
  queue_length: number;
  newest_msg_age_sec: number | null;
  oldest_msg_age_sec: number | null;
  total_messages: number;
  scrape_time: Date;
}
```

### `QueueInfo`
```typescript
interface QueueInfo {
  queue_name: string;
  created_at: Date;
  is_partitioned: boolean;
  is_unlogged: boolean;
}
```

## Examples

### Basic Worker Pattern

```typescript
import { PrismaClient } from './generated/prisma/client';
import { pgmq } from 'prisma-pgmq';

const prisma = new PrismaClient();

// Producer
async function sendTask(taskData: any) {
  await pgmq.send(prisma, 'work-queue', {
    type: 'process-user-data',
    data: taskData,
    timestamp: Date.now()
  });
}

// Consumer
async function processMessages() {
  const messages = await pgmq.readWithPoll(prisma, 'work-queue', 30, 5, 10, 1000);
  for (const message of messages) {
    try {
      // Process the message
      await handleTask(message.message);
      // Delete on success
      await pgmq.deleteMessage(prisma, 'work-queue', message.msg_id);
    } catch (error) {
      console.error('Task failed:', error);
      // Archive failed messages for later analysis
      await pgmq.archive(prisma, 'work-queue', message.msg_id);
    }
  }
}

async function handleTask(task: any) {
  // Your business logic here
  console.log('Processing task:', task.type);
}
```

### Delayed Message Scheduling

```typescript
// Schedule a message for later processing
const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

await pgmq.send(prisma, 'scheduled-tasks', {
  type: 'send-reminder',
  userId: 123,
  reminder: 'Your subscription expires tomorrow'
}, futureDate);
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Clone the repository
git clone https://github.com/dvlkv/prisma-pgmq.git
cd prisma-pgmq

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build the library
pnpm build

# Watch for changes during development
pnpm dev
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [PGMQ](https://github.com/pgmq/pgmq) - PostgreSQL Message Queue extension
- [Prisma](https://www.prisma.io/) - Next-generation ORM for TypeScript & Node.js
