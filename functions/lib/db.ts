import { createDatabaseClient } from '../_qoder/backend.mjs'
import type { DbError, DbQuery, DatabaseClient } from '../_qoder/backend.mjs'
import { HttpError } from './errors.ts'

export type Row = Record<string, unknown>
export type Filter = [column: string, value: unknown]

const DB_UNAVAILABLE = '数据库暂时不可用，请稍后重试'

export class DbRequestError extends HttpError {
  readonly dbCode: string

  constructor(error: DbError) {
    super(503, DB_UNAVAILABLE)
    this.name = 'DbRequestError'
    this.dbCode = error.code ?? ''
  }
}

let client: DatabaseClient | null = null

export function db(): DatabaseClient {
  if (client === null) client = createDatabaseClient()
  return client
}

async function settle<T>(query: DbQuery<T>): Promise<{ data: T[] | null; error: DbError | null }> {
  try {
    const result = await query
    return { data: (result.data ?? null) as T[] | null, error: result.error ?? null }
  } catch {
    throw new HttpError(503, DB_UNAVAILABLE)
  }
}

async function unwrap<T>(query: DbQuery<T>): Promise<T[]> {
  const { data, error } = await settle(query)
  if (error) throw new DbRequestError(error)
  return data ?? []
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DbRequestError && (error.dbCode === '23505' || error.dbCode === 'unique_violation')
}

export interface SelectOptions {
  order?: string
  ascending?: boolean
  limit?: number
}

export async function selectRows<T = Row>(
  table: string,
  columns = '*',
  filters: Filter[] = [],
  options: SelectOptions = {},
): Promise<T[]> {
  let query = db().from<T>(table).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  if (options.order) query = query.order(options.order, { ascending: options.ascending ?? true })
  if (options.limit) query = query.limit(options.limit)
  return unwrap(query)
}

export async function findRow<T = Row>(
  table: string,
  filters: Filter[],
  columns = '*',
): Promise<T | null> {
  const found = await selectRows<T>(table, columns, filters, { limit: 1 })
  return found.length > 0 ? found[0] : null
}

export async function insertRow<T = Row>(table: string, row: Row, columns = '*'): Promise<T | null> {
  const inserted = await unwrap(db().from<T>(table).insert(row).select(columns))
  return inserted.length > 0 ? inserted[0] : null
}

/** 小批量插入；单条失败时改用主键幂等插入，避免重复行。 */
export async function insertRows(table: string, values: Row[]): Promise<void> {
  if (values.length === 0) return
  const chunkSize = 25
  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize)
    try {
      await unwrap(db().from(table).insert(chunk))
    } catch (error) {
      if (!(error instanceof DbRequestError)) throw error
      for (const row of chunk) {
        try {
          await unwrap(db().from(table).insertIfAbsent(row, { onConflict: 'id' }))
        } catch (rowError) {
          if (isUniqueViolation(rowError)) continue
          throw rowError
        }
      }
    }
  }
}

export async function updateWhere<T = Row>(
  table: string,
  values: Row,
  filters: Filter[],
  columns: string | null = null,
): Promise<T[]> {
  let query = db().from<T>(table).update(values)
  for (const [column, value] of filters) query = query.eq(column, value)
  if (columns) query = query.select(columns)
  return unwrap(query)
}

export async function deleteWhere(table: string, filters: Filter[]): Promise<void> {
  let query = db().from(table).delete()
  for (const [column, value] of filters) query = query.eq(column, value)
  await unwrap(query)
}

export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function jsonValue<T>(value: unknown, fallback: T): T {
  return value === null || value === undefined ? fallback : (value as T)
}
