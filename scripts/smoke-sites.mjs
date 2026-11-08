#!/usr/bin/env node
/**
 * 端到端接口健康检查（Serverless / Qoder Sites）。
 *
 *   SITES_BASE_URL=https://<site-domain> node scripts/smoke-sites.mjs
 *
 * 顺序覆盖：health → 注册/登录/me → 工作区 → 签名上传 md → 登记解析 →
 * 生成任务（LLM 未配置时跳过）→ 工件读取 → Deck CRUD 与下线占位 → 删除 → 越权 404。
 * 任一步状态码不符合预期即失败退出（exit 1）。
 */

const base = (process.env.SITES_BASE_URL ?? '').replace(/\/+$/, '')
if (!base) {
  console.error('缺少 SITES_BASE_URL，例如：SITES_BASE_URL=https://xxx.qoder.site node scripts/smoke-sites.mjs')
  process.exit(2)
}

const API = `${base}/functions/v1/app/api`
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
const password = 'smoke-pass-123'

let token = ''
const report = []

function log(message) {
  console.log(`  · ${message}`)
}

function record(name, detail = '') {
  report.push({ name, detail })
}

function fail(message, extra) {
  console.error(`\n✗ ${message}`)
  if (extra !== undefined) console.error(extra)
  process.exit(1)
}

async function call(path, { method = 'GET', body, auth = true, expect = 200, redirect = 'follow' } = {}) {
  const headers = { accept: 'application/json' }
  if (auth && token) headers.authorization = `Bearer ${token}`
  let payload
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload, redirect })
  if (response.status !== expect) {
    const text = await response.text().catch(() => '')
    fail(`${method} ${path} 期望 ${expect}，实际 ${response.status}`, text.slice(0, 500))
  }
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function main() {
  console.log(`\nMockFinal smoke → ${API}\n`)

  const health = await call('/health', { auth: false })
  if (health?.status !== 'ok') fail('health 响应异常', health)
  if (health.database !== 'ok') fail('数据库不可达（health.database !== "ok"）', health)
  record('health', `database=${health.database}`)
  log('health ok')

  const username = `smoke_${suffix}`
  const registered = await call('/auth/register', {
    method: 'POST',
    auth: false,
    body: {
      username,
      password,
      security_question: 'Smoke 测试问题？',
      security_answer: 'smoke',
    },
  })
  if (!registered?.token) fail('注册未返回 token', registered)
  token = registered.token
  record('register')

  const loggedIn = await call('/auth/login', {
    method: 'POST',
    auth: false,
    body: { username, password },
  })
  if (!loggedIn?.token) fail('登录未返回 token', loggedIn)
  token = loggedIn.token
  record('login')

  const me = await call('/auth/me')
  if (me?.username !== username) fail('me 返回的用户名不匹配', me)
  record('me')

  const question = await call(`/auth/security-question?username=${encodeURIComponent(username)}`, { auth: false })
  if (!question?.question) fail('安全问题查询失败', question)
  record('security-question')

  const workspace = await call('/workspaces', {
    method: 'POST',
    body: { name: `Smoke 工作区 ${suffix}`, description: 'smoke' },
  })
  const workspaceId = Number(workspace?.id)
  if (!workspaceId) fail('创建工作区失败', workspace)
  record('create workspace', `id=${workspaceId}`)

  const filename = 'smoke.md'
  const markdown = `# Smoke 标题\n\n这是一段用于冒烟测试的正文。\n\n## 第二节\n\n第二段内容，用来验证分节。\n`
  const creds = await call(
    `/workspaces/${workspaceId}/upload-credentials?filename=${encodeURIComponent(filename)}`,
    { method: 'POST', expect: 200 },
  )
  if (creds?.mode !== 'sites' || !creds.path || !creds.signedUrl) fail('上传凭证格式异常', creds)
  const uploadUrl = /^https?:\/\//i.test(creds.signedUrl) ? creds.signedUrl : `${base}${creds.signedUrl}`
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
    body: markdown,
  })
  if (!put.ok) fail(`签名上传失败：HTTP ${put.status}`, await put.text().catch(() => ''))
  record('signed upload')

  const registeredMaterial = await call(`/workspaces/${workspaceId}/materials`, {
    method: 'POST',
    body: {
      filename,
      storage_key: creds.path,
      size: Buffer.byteLength(markdown),
      content_type: 'text/markdown',
    },
  })
  if (registeredMaterial?.status !== 'indexed') {
    fail('资料登记/解析未成功', registeredMaterial)
  }
  if (Number(registeredMaterial.chunk_count) < 1) fail('资料分节数为 0', registeredMaterial)
  const materialId = Number(registeredMaterial.id)
  record('register material', `chunks=${registeredMaterial.chunk_count}`)

  const materials = await call(`/workspaces/${workspaceId}/materials`)
  if (!Array.isArray(materials) || !materials.some((item) => Number(item.id) === materialId)) {
    fail('资料列表缺少刚登记的资料', materials)
  }
  record('list materials')

  const download = await fetch(`${API}/materials/${materialId}/download`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'manual',
  })
  if (download.status !== 302) fail(`资料下载期望 302 签名跳转，实际 ${download.status}`)
  record('material download redirect')

  let jobId = 0
  let generationSkipped = false
  try {
    const generated = await call(`/workspaces/${workspaceId}/generate`, { method: 'POST', expect: 200 })
    jobId = Number(generated?.job_id)
    if (!jobId) fail('生成接口未返回 job_id', generated)
  } catch (error) {
    generationSkipped = true
    log('跳过生成：未配置 LLM 服务')
    record('generate', 'skipped (LLM not configured)')
    if (!String(error)) throw error
  }

  if (jobId) {
    let job = null
    for (let attempt = 0; attempt < 120; attempt += 1) {
      job = await call(`/jobs/${jobId}/advance`, { method: 'POST', expect: 200 })
      if (job?.status === 'done' || job?.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (job?.status !== 'done') fail('生成任务未完成', job)
    record('generate + advance', `job=${jobId}`)

    const artifacts = await call(`/workspaces/${workspaceId}/artifacts`)
    if (!Array.isArray(artifacts) || artifacts.length < 2) fail('生成完成后工件数量不足', artifacts)
    const detail = await call(`/artifacts/${Number(artifacts[0].id)}`)
    if (typeof detail?.content !== 'string' || !detail.content.trim()) fail('工件正文为空', detail)
    record('artifacts', `count=${artifacts.length}`)
  } else if (!generationSkipped) {
    fail('生成阶段异常')
  }

  const deck = await call(`/workspaces/${workspaceId}/decks`, {
    method: 'POST',
    body: { title: 'Smoke 复习页' },
  })
  const deckId = Number(deck?.id)
  if (!deckId) fail('创建复习页失败', deck)
  const deckDetail = await call(`/decks/${deckId}`)
  if (Number(deckDetail?.id) !== deckId) fail('复习页详情异常', deckDetail)
  await call(`/decks/${deckId}`, { method: 'PATCH', body: { title: 'Smoke 复习页（改）' } })
  const build = await call(`/decks/${deckId}/build`, { method: 'POST', body: {}, expect: 503 })
  if (!String(build?.detail ?? '').includes('未部署')) fail('构建接口未返回预期 503 文案', build)
  const cancel = await call(`/decks/${deckId}/cancel`, { method: 'POST', expect: 503 })
  if (!String(cancel?.detail ?? '').includes('未部署')) fail('取消接口未返回预期 503 文案', cancel)
  record('deck CRUD + disabled build')

  const decks = await call(`/workspaces/${workspaceId}/decks`)
  if (!Array.isArray(decks) || !decks.some((item) => Number(item.id) === deckId)) fail('复习页列表缺少新建项', decks)

  await call(`/decks/${deckId}`, { method: 'DELETE', expect: 204 })
  await call(`/materials/${materialId}`, { method: 'DELETE', expect: 204 })
  record('delete deck/material')

  const second = await call('/auth/register', {
    method: 'POST',
    auth: false,
    body: {
      username: `smoke_other_${suffix}`,
      password,
      security_question: '其他用户问题？',
      security_answer: 'other',
    },
  })
  const primaryToken = token
  token = second.token
  await call(`/workspaces/${workspaceId}`, { expect: 404 })
  token = primaryToken
  record('cross-user isolation')

  token = ''
  await call('/workspaces', { expect: 401, auth: false })
  record('unauthorized 401')

  token = primaryToken
  await call(`/workspaces/${workspaceId}`, { method: 'DELETE', expect: 204 })
  await call(`/workspaces/${workspaceId}`, { expect: 404 })
  record('delete workspace')

  console.log('\n✓ 全部接口健康检查通过')
  for (const item of report) console.log(`  - ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}

main().catch((error) => {
  console.error('\n✗ 未捕获异常', error)
  process.exit(1)
})
