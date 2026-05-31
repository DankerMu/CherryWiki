# Drizzle ORM Usage in CherryWiki

CherryWiki uses Drizzle ORM for type-safe PostgreSQL access.

## Schema Definition

```typescript
import { pgTable, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { vector } from 'pgvector/drizzle-orm';

export const wiki_pages = pgTable('wiki_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  space_id: uuid('space_id').notNull(),
  tenant_id: text('tenant_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull().default('published'),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

export const wiki_chunks = pgTable('wiki_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  wiki_page_id: uuid('wiki_page_id').notNull().references(() => wiki_pages.id),
  space_id: uuid('space_id').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 3072 }),
  chunk_index: integer('chunk_index').notNull(),
  snapshot_id: uuid('snapshot_id').notNull(),
  source_chain_json: jsonb('source_chain_json'),
});
```

## Query Patterns

### Insert with returning
```typescript
const [page] = await db.insert(wiki_pages).values({
  space_id: spaceId,
  tenant_id: tenantId,
  title: 'New Page',
  content: markdownContent,
  status: 'published',
  created_by: userId,
}).returning();
```

### Select with joins
```typescript
const results = await db
  .select({
    chunk: wiki_chunks,
    page: { title: wiki_pages.title, status: wiki_pages.status },
  })
  .from(wiki_chunks)
  .innerJoin(wiki_pages, eq(wiki_chunks.wiki_page_id, wiki_pages.id))
  .where(and(
    eq(wiki_chunks.space_id, spaceId),
    eq(wiki_pages.status, 'published'),
  ))
  .limit(10);
```

### Vector similarity search
```typescript
import { cosineDistance, sql } from 'drizzle-orm';

const similar = await db
  .select({
    id: wiki_chunks.id,
    content: wiki_chunks.content,
    score: sql<number>`1 - (${cosineDistance(wiki_chunks.embedding, queryVector)})`,
  })
  .from(wiki_chunks)
  .where(eq(wiki_chunks.snapshot_id, activeSnapshotId))
  .orderBy(cosineDistance(wiki_chunks.embedding, queryVector))
  .limit(8);
```

## Transaction Patterns

```typescript
await db.transaction(async (tx) => {
  const [page] = await tx.insert(wiki_pages).values(pageData).returning();
  await tx.insert(wiki_chunks).values(
    chunks.map((c, i) => ({ ...c, wiki_page_id: page.id, chunk_index: i }))
  );
});
```
