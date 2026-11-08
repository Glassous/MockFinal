export interface ValidationIssue {
  loc: Array<string | number>
  msg: string
  type: string
}

export type ErrorDetail = string | ValidationIssue[]

/** 业务异常：status + 前端契约要求的 detail 形状。 */
export class HttpError extends Error {
  readonly status: number
  readonly detail: ErrorDetail
  readonly headers: Record<string, string>

  constructor(status: number, detail: ErrorDetail, headers: Record<string, string> = {}) {
    super(typeof detail === 'string' ? detail : 'validation_error')
    this.name = 'HttpError'
    this.status = status
    this.detail = detail
    this.headers = headers
  }
}

export function validationError(fields: Record<string, string>): HttpError {
  const issues: ValidationIssue[] = Object.entries(fields).map(([key, msg]) => ({
    loc: ['body', key],
    msg,
    type: 'value_error',
  }))
  return new HttpError(422, issues)
}
