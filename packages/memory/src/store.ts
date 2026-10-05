import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, LATEST_VERSION, pendingMigrations } from './migrations.js'

export interface RecordRow {
  id: string
  kind: string
  payload: string
  created_at: number
  updated_at: number
}

/**
 * The store. Backed by SQLite through the runtime's own `node:sqlite` binding rather than a
 * native addon: an installed copy of this product must not need a C++ toolchain, and the
 * queries here are plain SQL that both bindings execute identically. See
 * `docs/adr/0003-storage-choice.md`.
 */
export class Store {
  readonly #db: DatabaseSync
  readonly #path: string
  #depth = 0

  constructor(path = ':memory:') {
    this.#path = path
    this.#db = new DatabaseSync(path)
    // WAL is meaningless for :memory: (SQLite reports "memory" there) but harmless, and a
    // file-backed database gets real concurrent-reader behaviour.
    this.#db.exec('PRAGMA journal_mode = WAL')
    this.#db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  get path(): string {
    return this.#path
  }

  get version(): number {
    const row = this.#db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
    return row?.user_version ?? 0
  }

  get isPending(): boolean {
    return pendingMigrations(this.version).length > 0
  }

  migrate(): number {
    for (const migration of pendingMigrations(this.version)) {
      this.transaction(() => {
        for (const statement of migration.up) this.#db.exec(statement)
        this.#db.exec(`PRAGMA user_version = ${migration.version}`)
      })
    }
    return this.version
  }

  /**
   * Every write goes through this helper — no ad-hoc exec outside it. Nesting is supported
   * with SAVEPOINTs, so a `put()` inside a caller's `transaction()` is atomic with it rather
   * than failing on a nested BEGIN.
   */
  transaction<T>(fn: () => T): T {
    const outermost = this.#depth === 0
    const savepoint = `sf_tx_${this.#depth}`
    this.#depth += 1

    if (outermost) this.#db.exec('BEGIN IMMEDIATE')
    else this.#db.exec(`SAVEPOINT ${savepoint}`)

    try {
      const result = fn()
      if (outermost) this.#db.exec('COMMIT')
      else this.#db.exec(`RELEASE ${savepoint}`)
      return result
    } catch (error) {
      if (outermost) this.#db.exec('ROLLBACK')
      else {
        this.#db.exec(`ROLLBACK TO ${savepoint}`)
        this.#db.exec(`RELEASE ${savepoint}`)
      }
      throw error
    } finally {
      this.#depth = outermost ? 0 : this.#depth - 1
    }
  }

  put(record: { id: string; kind: string; payload: unknown; now: number }): void {
    const text = JSON.stringify(record.payload)
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO records (id, kind, payload, created_at, updated_at)
           VALUES (@id, @kind, @payload, @now, @now)
           ON CONFLICT(id) DO UPDATE SET
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
        )
        .run({ id: record.id, kind: record.kind, payload: text, now: record.now })

      // FTS5 virtual tables reject UPSERT, so the index row is replaced explicitly.
      this.#db.prepare('DELETE FROM records_fts WHERE id = ?').run(record.id)
      this.#db.prepare('INSERT INTO records_fts (id, body) VALUES (?, ?)').run(record.id, text)
    })
  }

  get(id: string): RecordRow | undefined {
    return this.#db.prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined
  }

  list(kind: string, limit = 50): readonly RecordRow[] {
    return this.#db
      .prepare('SELECT * FROM records WHERE kind = ? ORDER BY updated_at DESC LIMIT ?')
      .all(kind, limit) as unknown as RecordRow[]
  }

  search(query: string, limit = 50): readonly RecordRow[] {
    return this.#db
      .prepare(
        `SELECT r.* FROM records_fts f
           JOIN records r ON r.id = f.id
           WHERE records_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as unknown as RecordRow[]
  }

  delete(id: string): boolean {
    return this.transaction(() => {
      const result = this.#db.prepare('DELETE FROM records WHERE id = ?').run(id)
      this.#db.prepare('DELETE FROM records_fts WHERE id = ?').run(id)
      return result.changes > 0
    })
  }

  close(): void {
    this.#db.close()
  }
}

export { LATEST_VERSION, MIGRATIONS }
