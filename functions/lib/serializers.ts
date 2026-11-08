import { bool, jsonValue, num, str, strOrNull, type Row } from './db.ts'

export function userOut(row: Row): Record<string, unknown> {
  return { id: num(row.id), username: str(row.username) }
}

export function workspaceOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    name: str(row.name),
    description: str(row.description),
    created_at: str(row.created_at),
  }
}

export function materialOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    workspace_id: num(row.workspace_id),
    filename: str(row.filename),
    storage_key: str(row.storage_key),
    size: num(row.size),
    content_type: str(row.content_type, 'application/octet-stream'),
    status: str(row.status, 'uploaded'),
    error: strOrNull(row.error),
    chunk_count: num(row.chunk_count),
    created_at: str(row.created_at),
  }
}

export function jobOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    status: str(row.status, 'pending'),
    stage: strOrNull(row.stage),
    error: strOrNull(row.error),
  }
}

export function artifactOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    kind: str(row.kind),
    title: str(row.title),
    created_at: str(row.created_at),
  }
}

export function artifactDetail(row: Row, content: string): Record<string, unknown> {
  return { ...artifactOut(row), content }
}

function intOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  return null
}

export function deckPageSummary(page: Row): Record<string, unknown> {
  const manifest = jsonValue<Record<string, unknown>>(page.manifest, {})
  const validation = jsonValue<Record<string, unknown>>(page.validation, {})
  const manifestTitle = manifest.title
  const issues = validation.issues
  const issueCount = Number.isInteger(validation.issue_count)
    ? num(validation.issue_count)
    : Array.isArray(issues)
      ? issues.length
      : 0
  const teaching = jsonValue<Record<string, unknown>>(manifest.teaching, {})
  const checks = teaching.check
  const teachingReport = jsonValue<Record<string, unknown>>(validation.teaching, {})
  return {
    id: num(page.id),
    ordinal: num(page.ordinal),
    title: str(page.title),
    kind: str(page.kind, 'concept'),
    status: str(page.status, 'planned'),
    current_version: num(page.current_version),
    primary_knowledge_point_id: intOrNull(page.primary_knowledge_point_id),
    knowledge_point_ids: jsonValue<number[]>(page.knowledge_point_ids, []),
    has_bundle: Boolean(page.bundle_key),
    manifest_title: typeof manifestTitle === 'string' && manifestTitle.trim() ? manifestTitle : null,
    validation_status: typeof validation.status === 'string' && validation.status ? validation.status : null,
    validation_issue_count: issueCount,
    teaching_role: typeof teaching.role === 'string' && teaching.role ? teaching.role : null,
    estimated_minutes: intOrNull(manifest.estimated_minutes),
    check_count: Array.isArray(checks) ? checks.length : 0,
    teaching_score: intOrNull(teachingReport.score),
  }
}

export function deckPageOut(page: Row): Record<string, unknown> {
  return {
    id: num(page.id),
    deck_id: num(page.deck_id),
    knowledge_point_ids: jsonValue<number[]>(page.knowledge_point_ids, []),
    primary_knowledge_point_id: intOrNull(page.primary_knowledge_point_id),
    ordinal: num(page.ordinal),
    title: str(page.title),
    kind: str(page.kind, 'concept'),
    status: str(page.status, 'planned'),
    current_version: num(page.current_version),
    bundle_key: strOrNull(page.bundle_key),
    thumbnail_key: strOrNull(page.thumbnail_key),
    manifest: jsonValue<Record<string, unknown>>(page.manifest, {}),
    validation: jsonValue<Record<string, unknown>>(page.validation, {}),
    build_attempts: num(page.build_attempts),
    builder_build_id: strOrNull(page.builder_build_id),
    created_at: str(page.created_at),
    updated_at: str(page.updated_at),
  }
}

function continuePageId(deck: Row, pages: Row[]): number | null {
  const lastPageId = intOrNull(deck.last_page_id)
  const byId = new Map(pages.map((page) => [num(page.id), page]))
  if (lastPageId !== null) {
    const last = byId.get(lastPageId)
    if (last && str(last.status) !== 'canceled') return lastPageId
  }
  for (const page of pages) if (str(page.status) === 'ready') return num(page.id)
  for (const page of pages) if (str(page.status) !== 'canceled') return num(page.id)
  return null
}

export function deckOut(
  deck: Row,
  pages: Row[],
  extras: { sourceChanged: boolean; activeJobId: number | null; lastJobId: number | null },
): Record<string, unknown> {
  return {
    id: num(deck.id),
    workspace_id: num(deck.workspace_id),
    title: str(deck.title),
    status: str(deck.status, 'draft'),
    style: jsonValue<Record<string, unknown>>(deck.style, {}),
    outline: jsonValue<Record<string, unknown>>(deck.outline, {}),
    source_signature: strOrNull(deck.source_signature),
    last_page_id: intOrNull(deck.last_page_id),
    completed_page_ids: jsonValue<number[]>(deck.completed_page_ids, []),
    created_at: str(deck.created_at),
    updated_at: str(deck.updated_at),
    pages: pages.map(deckPageSummary),
    total_pages: pages.length,
    ready_pages: pages.filter((page) => str(page.status) === 'ready').length,
    failed_pages: pages.filter((page) => str(page.status) === 'failed').length,
    planned_pages: pages.filter((page) => str(page.status) === 'planned').length,
    continue_page_id: continuePageId(deck, pages),
    active_job_id: extras.activeJobId,
    last_job_id: extras.lastJobId,
    source_changed: extras.sourceChanged,
  }
}

export function deckJobOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    deck_id: num(row.deck_id),
    workspace_id: num(row.workspace_id),
    status: str(row.status, 'pending'),
    stage: strOrNull(row.stage),
    progress: num(row.progress),
    total_pages: num(row.total_pages),
    ready_pages: num(row.ready_pages),
    failed_pages: num(row.failed_pages),
    error: strOrNull(row.error),
    cancel_requested: bool(row.cancel_requested),
    target_page_id: intOrNull(row.target_page_id),
    created_at: str(row.created_at),
    started_at: strOrNull(row.started_at),
    finished_at: strOrNull(row.finished_at),
  }
}

export function deckEventOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    job_id: num(row.job_id),
    page_id: intOrNull(row.page_id),
    type: str(row.type),
    payload: jsonValue<Record<string, unknown>>(row.payload, {}),
    created_at: str(row.created_at),
  }
}

export function pageMessageOut(row: Row): Record<string, unknown> {
  return {
    id: num(row.id),
    deck_id: num(row.deck_id),
    page_id: num(row.page_id),
    role: str(row.role),
    status: str(row.status, 'done'),
    content: str(row.content),
    quote: strOrNull(row.quote),
    context_refs: jsonValue<Array<Record<string, unknown>>>(row.context_refs, []),
    created_at: str(row.created_at),
  }
}
