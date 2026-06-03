// Minimal in-memory drizzle stand-in for the graphify post-completion pipeline (wiki generation +
// source_documents status write-back). It supports the narrow query shapes those code paths use:
//   - select(projection).from(table).where(cond) -> Promise<rows>
//   - insert(table).values(row|rows)
//   - update(table).set(patch).where(cond) [.returning(projection)]
//   - transaction(cb) (runs inline against the same store)
// Filtering is done by replaying recorded eq()/and()/inArray()/sql conditions against each row.

type Row = Record<string, unknown>;

type Condition = (row: Row) => boolean;

export class FakeGraphPipelineDb {
  readonly communities: Row[] = [];
  readonly nodes: Row[] = [];
  readonly edges: Row[] = [];
  readonly pages: Row[] = [];
  readonly versions: Row[] = [];
  readonly sourceDocuments: Row[] = [];

  private tableFor(name: string): Row[] {
    switch (name) {
      case 'graph_communities':
        return this.communities;
      case 'graph_nodes':
        return this.nodes;
      case 'graph_edges':
        return this.edges;
      case 'wiki_pages':
        return this.pages;
      case 'wiki_page_versions':
        return this.versions;
      case 'source_documents':
        return this.sourceDocuments;
      default:
        throw new Error(`FakeGraphPipelineDb: unknown table ${name}`);
    }
  }

  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(this);
  }

  select(projection?: Record<string, unknown>): SelectBuilder {
    return new SelectBuilder(this, projection);
  }

  insert(table: TableLike): InsertBuilder {
    return new InsertBuilder(this.tableFor(tableName(table)));
  }

  update(table: TableLike): UpdateBuilder {
    return new UpdateBuilder(this.tableFor(tableName(table)));
  }

  rowsFor(name: string): Row[] {
    return this.tableFor(name);
  }

  asDb(): unknown {
    return this;
  }
}

class SelectBuilder {
  private projection: Record<string, unknown> | undefined;
  private rows: Row[] = [];

  constructor(private readonly db: FakeGraphPipelineDb, projection?: Record<string, unknown>) {
    this.projection = projection;
  }

  from(table: TableLike): this {
    this.rows = this.db.rowsFor(tableName(table));
    return this;
  }

  where(condition: unknown): Promise<Row[]> {
    const predicate = toPredicate(condition);
    const matched = this.rows.filter(predicate);
    return Promise.resolve(matched.map((row) => this.project(row)));
  }

  private project(row: Row): Row {
    if (this.projection === undefined) {
      return { ...row };
    }
    const result: Row = {};
    for (const [alias, column] of Object.entries(this.projection)) {
      result[alias] = row[columnName(column)];
    }
    return result;
  }
}

class InsertBuilder {
  constructor(private readonly store: Row[]) {}

  values(rows: Row | Row[]): Promise<void> {
    const list = Array.isArray(rows) ? rows : [rows];
    for (const row of list) {
      this.store.push({ ...row });
    }
    return Promise.resolve();
  }
}

class UpdateBuilder {
  private patch: Row = {};

  constructor(private readonly store: Row[]) {}

  set(patch: Row): this {
    this.patch = patch;
    return this;
  }

  where(condition: unknown): UpdateResult {
    const predicate = toPredicate(condition);
    const updated: Row[] = [];
    for (const row of this.store) {
      if (predicate(row)) {
        Object.assign(row, this.patch);
        updated.push(row);
      }
    }
    return new UpdateResult(updated);
  }
}

class UpdateResult implements PromiseLike<Row[]> {
  constructor(private readonly updated: Row[]) {}

  returning(projection?: Record<string, unknown>): Promise<Row[]> {
    if (projection === undefined) {
      return Promise.resolve(this.updated);
    }
    return Promise.resolve(
      this.updated.map((row) => {
        const result: Row = {};
        for (const [alias, column] of Object.entries(projection)) {
          result[alias] = row[columnName(column)];
        }
        return result;
      }),
    );
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.updated).then(onfulfilled, onrejected);
  }
}

type TableLike = { [key: symbol]: unknown };

// drizzle's eq/and/inArray/sql all compile to a single SQL object with a `queryChunks` token stream
// (verified at runtime). We flatten that stream into a linear token list and interpret the only
// shapes our code paths produce: conjunctions of `column = $param`, `column in ($params)`, and one
// `${column}->>'key' = $param` json-path comparison. All conditions in our queries are pure ANDs.
type Token =
  | { kind: 'col'; name: string }
  | { kind: 'op'; text: string }
  | { kind: 'param'; value: unknown }
  | { kind: 'array'; values: unknown[] };

function toPredicate(condition: unknown): Condition {
  const tokens: Token[] = [];
  flattenSql(condition, tokens);
  const comparisons = parseComparisons(tokens);
  return (row) => comparisons.every((compare) => compare(row));
}

function flattenSql(node: unknown, out: Token[]): void {
  if (node === null || typeof node !== 'object') {
    return;
  }
  const chunks = (node as Record<string, unknown>).queryChunks;
  if (!Array.isArray(chunks)) {
    return;
  }

  for (const chunk of chunks) {
    if (chunk === null) {
      continue;
    }
    // Raw `sql` templates inline interpolated primitives as bare values (NOT Param objects, unlike
    // eq()/inArray()) — e.g. sql`${col}->>'k' = ${runId}` puts runId in the stream as a plain string.
    // Capture those as params so json-path comparisons keep their right-hand side.
    if (typeof chunk !== 'object') {
      out.push({ kind: 'param', value: chunk });
      continue;
    }
    const ctor = (chunk as { constructor?: { name?: string } }).constructor?.name;
    const obj = chunk as Record<string, unknown>;

    if (ctor === 'SQL') {
      flattenSql(chunk, out);
    } else if (ctor === 'StringChunk') {
      const text = Array.isArray(obj.value) ? obj.value.join('') : String(obj.value ?? '');
      out.push({ kind: 'op', text });
    } else if (ctor === 'Param') {
      out.push({ kind: 'param', value: obj.value });
    } else if (Array.isArray(chunk)) {
      out.push({ kind: 'array', values: chunk.map((entry) => paramValue(entry)) });
    } else if (typeof obj.name === 'string') {
      out.push({ kind: 'col', name: obj.name });
    }
  }
}

function paramValue(entry: unknown): unknown {
  if (entry !== null && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)) {
    return (entry as Record<string, unknown>).value;
  }
  return entry;
}

function parseComparisons(tokens: Token[]): Condition[] {
  const comparisons: Condition[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'col') {
      continue;
    }
    const op = tokens[index + 1];
    const rhs = tokens[index + 2];
    if (op?.kind !== 'op') {
      continue;
    }

    // ${column}->>'key' = $param  (json path)
    const jsonMatch = /->>'([^']+)'\s*=/.exec(op.text);
    if (jsonMatch && rhs?.kind === 'param') {
      const colName = token.name;
      const key = jsonMatch[1]!;
      const expected = rhs.value;
      comparisons.push((row) => {
        const json = row[colName];
        if (json === null || typeof json !== 'object') {
          return false;
        }
        return (json as Record<string, unknown>)[key] === expected;
      });
      index += 2;
      continue;
    }

    if (/\bin\b/.test(op.text) && rhs?.kind === 'array') {
      const colName = token.name;
      const values = rhs.values;
      comparisons.push((row) => values.includes(row[colName]));
      index += 2;
      continue;
    }

    if (op.text.includes('=') && rhs?.kind === 'param') {
      const colName = token.name;
      const expected = rhs.value;
      comparisons.push((row) => row[colName] === expected);
      index += 2;
    }
  }

  return comparisons;
}

function columnName(column: unknown): string {
  if (column !== null && typeof column === 'object' && typeof (column as Record<string, unknown>).name === 'string') {
    return (column as Record<string, unknown>).name as string;
  }
  throw new Error('FakeGraphPipelineDb: could not resolve column name');
}

function tableName(table: TableLike): string {
  for (const symbol of Object.getOwnPropertySymbols(table)) {
    if (symbol.description?.includes('Name')) {
      const value = (table as Record<symbol, unknown>)[symbol];
      if (typeof value === 'string') {
        return value;
      }
    }
  }
  throw new Error('FakeGraphPipelineDb: could not resolve table name');
}
