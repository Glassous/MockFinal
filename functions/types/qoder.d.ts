// Platform-supplied runtime types. `_qoder/*` modules are injected at deploy time.

declare namespace Deno {
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown
  const env: { get(name: string): string | undefined }
}

declare module '*_qoder/backend.mjs' {
  export interface DbError {
    code?: string
    status?: number
    message?: string
  }

  export interface DbResult<T = Record<string, unknown>> {
    data: T[] | null
    error: DbError | null
    count?: number | null
  }

  export interface DbQuery<T = Record<string, unknown>> extends PromiseLike<DbResult<T>> {
    select(columns?: string, options?: Record<string, unknown>): DbQuery<T>
    insert(values: Record<string, unknown> | Record<string, unknown>[]): DbQuery<T>
    insertIfAbsent(values: Record<string, unknown>, options: { onConflict: string }): DbQuery<T>
    update(values: Record<string, unknown>): DbQuery<T>
    delete(): DbQuery<T>
    eq(column: string, value: unknown): DbQuery<T>
    order(column: string, options?: { ascending?: boolean }): DbQuery<T>
    limit(count: number): DbQuery<T>
  }

  export interface DatabaseClient {
    from<T = Record<string, unknown>>(table: string): DbQuery<T>
  }

  export function createDatabaseClient(): DatabaseClient
}

declare module '*_qoder/storage.mjs' {
  export interface SignedUrl {
    signedUrl: string
  }

  export interface StorageClient {
    list(path: string, options?: Record<string, unknown>): Promise<unknown>
    upload(
      path: string,
      body: BodyInit,
      options?: { contentType?: string; upsert?: boolean },
    ): Promise<unknown>
    download(path: string): Promise<Response>
    remove(paths: string[]): Promise<unknown>
    createSignedUploadUrl(path: string, options?: { upsert?: boolean }): Promise<SignedUrl>
    createSignedUrl(path: string, expiresIn: number): Promise<SignedUrl>
  }

  export function createStorageClient(): StorageClient
  export const storage: StorageClient
}
