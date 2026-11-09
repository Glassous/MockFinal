#!/usr/bin/env node
/**
 * 端到端接口健康检查（Serverless / Qoder Sites）。
 *
 *   SITES_BASE_URL=https://<site-domain> node scripts/smoke-sites.mjs
 *
 * 覆盖：health → 注册/登录 → 上传 → 全文生成（map-reduce）→ 两篇工件 →
 * 复习页构建（逐页 advance）→ bundle → 页面问答 → 取消 → 单页重做版本 +1 →
 * 删除 → 越权 404。需要站点已配置 LLM Secrets。
 * 任一步不符合预期即失败退出（exit 1）。
 */

const base = (process.env.SITES_BASE_URL ?? '').replace(/\/+$/, '')
if (!base) {
  console.error('缺少 SITES_BASE_URL，例如：SITES_BASE_URL=https://xxx.qoder.site node scripts/smoke-sites.mjs')
  process.exit(2)
}

const API = `${base}/functions/v1/app`
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
const password = 'smoke-pass-123'
const maxAdvance = Number(process.env.SMOKE_MAX_ADVANCE ?? 400)
const advanceDelay = Number(process.env.SMOKE_ADVANCE_DELAY_MS ?? 400)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  if (extra !== undefined) {
    console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2).slice(0, 2000))
  }
  process.exit(1)
}

async function callStatus(path, { method = 'GET', body, auth = true, redirect = 'follow' } = {}) {
  const headers = { accept: 'application/json', origin: base }
  if (auth && token) headers.authorization = `Bearer ${token}`
  let payload
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload, redirect })
  const text = await response.text().catch(() => '')
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status: response.status, data }
}

async function call(path, options = {}) {
  const expect = options.expect ?? 200
  const { status, data } = await callStatus(path, options)
  const allowed = Array.isArray(expect) ? expect : [expect]
  if (!allowed.includes(status)) {
    fail(`${options.method ?? 'GET'} ${path} 期望 ${allowed.join('/')}，实际 ${status}`, data)
  }
  return data
}

async function advanceUntil(pathBase, id, isTerminal, label) {
  let last = null
  for (let attempt = 0; attempt < maxAdvance; attempt += 1) {
    const { status, data } = await callStatus(`${pathBase}/${id}/advance`, { method: 'POST' })
    if (status === 429 || status === 502 || status === 504) {
      log(`${label} 遇到 ${status}，退避 3s 后继续`)
      await sleep(3000)
      continue
    }
    if (status !== 200) fail(`${label} advance 失败：HTTP ${status}`, data)
    last = data
    if (isTerminal(last)) return last
    await sleep(advanceDelay)
  }
  fail(`${label} 在 ${maxAdvance} 次 advance 内未完成`, last)
}

function generationTerminal(job) {
  return job?.status === 'done' || job?.status === 'failed'
}

function deckTerminal(job) {
  return ['done', 'partial', 'failed', 'canceled'].includes(job?.status)
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
  const markdown = [
    '# 复数与解析函数',
    '',
    '复数写成 z = x + iy，其中 x 为实部、y 为虚部，模 |z| = √(x² + y²)，',
    '辐角 arg z 表示向量与实轴正方向的夹角，共轭 z̄ = x - iy。复平面上的点与复数一一对应。',
    '',
    '## 解析函数与 Cauchy-Riemann 方程',
    '',
    '函数 f(z) = u(x, y) + iv(x, y) 在区域内解析，需要 u、v 在该区域内可微并满足',
    'Cauchy-Riemann 方程：∂u/∂x = ∂v/∂y，∂u/∂y = -∂v/∂x。解析函数具有任意阶导数，且实部与虚部都是调和函数。',
    '',
    '## 复积分与留数定理',
    '',
    '沿闭曲线的解析函数积分为零（Cauchy 积分定理）。若 f 在简单闭曲线内部除有限个孤立奇点外解析，',
    '则积分等于 2πi 乘以各奇点留数之和。留数 Res(f, z0) 是 Laurent 展开中 (z - z0)^(-1) 项的系数。',
    '',
    '## 典型例题',
    '',
    '计算 ∮ e^z / (z - 1) dz，积分路径为 |z| = 2。被积函数在 z = 1 有一阶极点，',
    '留数 Res = e^1 = e，故积分等于 2πi·e。',
    '',
    '## 常见错误',
    '',
    '把 Cauchy-Riemann 方程当成解析的充分条件而忽略偏导连续；判断留数定理适用条件时漏看奇点是否落在围线内部，',
    '都是最常见的失分点。',
    '',
  ].join('\n')
  const creds = await call(
    `/workspaces/${workspaceId}/upload-credentials?filename=${encodeURIComponent(filename)}`,
    { method: 'POST', expect: 200 },
  )
  if (creds?.mode !== 'sites' || !creds.path || !creds.signedUrl) fail('上传凭证格式异常', creds)
  const uploadUrl = /^https?:\/\//i.test(creds.signedUrl) ? creds.signedUrl : `${base}${creds.signedUrl}`
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/markdown; charset=utf-8', origin: base },
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
  if (registeredMaterial?.status !== 'indexed') fail('资料登记/解析未成功', registeredMaterial)
  if (Number(registeredMaterial.chunk_count) < 1) fail('资料分节数为 0', registeredMaterial)
  const materialId = Number(registeredMaterial.id)
  record('register material', `chunks=${registeredMaterial.chunk_count}`)

  const materials = await call(`/workspaces/${workspaceId}/materials`)
  if (!Array.isArray(materials) || !materials.some((item) => Number(item.id) === materialId)) {
    fail('资料列表缺少刚登记的资料', materials)
  }
  record('list materials')

  const download = await fetch(`${API}/materials/${materialId}/download`, {
    headers: { authorization: `Bearer ${token}`, origin: base },
    redirect: 'manual',
  })
  if (download.status !== 302) fail(`资料下载期望 302 签名跳转，实际 ${download.status}`)
  record('material download redirect')

  const generated = await call(`/workspaces/${workspaceId}/generate`, { method: 'POST' })
  const generationJobId = Number(generated?.job_id)
  if (!generationJobId) fail('生成接口未返回 job_id', generated)
  const generationJob = await advanceUntil('/jobs', generationJobId, generationTerminal, '生成任务')
  if (generationJob.status !== 'done') fail('生成任务未成功完成', generationJob)
  record('generate + advance', `job=${generationJobId}`)

  const artifacts = await call(`/workspaces/${workspaceId}/artifacts`)
  if (!Array.isArray(artifacts)) fail('工件列表格式异常', artifacts)
  const review = artifacts.find((item) => item.kind === 'review')
  const exam = artifacts.find((item) => item.kind === 'exam')
  if (!review || !exam) fail('缺少复习稿或试卷工件', artifacts)
  for (const artifact of [review, exam]) {
    const detail = await call(`/artifacts/${Number(artifact.id)}`)
    if (typeof detail?.content !== 'string' || detail.content.trim().length < 200) {
      fail(`工件正文过短（${artifact.kind}）`, detail)
    }
  }
  record('artifacts', `count=${artifacts.length}`)

  const deck = await call(`/workspaces/${workspaceId}/decks`, {
    method: 'POST',
    body: {
      title: 'Smoke 复习页',
      style: { preset: 'editorial', content: [], density: 'standard', custom_prompt: '' },
    },
  })
  const deckId = Number(deck?.id)
  if (!deckId) fail('创建复习页失败', deck)
  const deckDetail = await call(`/decks/${deckId}`)
  if (Number(deckDetail?.id) !== deckId) fail('复习页详情异常', deckDetail)

  const build = await call(`/decks/${deckId}/build`, { method: 'POST', body: { replan: false } })
  const buildJobId = Number(build?.job_id)
  if (!buildJobId) fail('构建接口未返回 job_id', build)
  const buildJob = await advanceUntil('/deck-jobs', buildJobId, deckTerminal, '复习页构建')
  if (buildJob.status !== 'done') fail('复习页未完整构建成功', buildJob)
  const built = await call(`/decks/${deckId}`)
  if (built?.status !== 'ready') fail('复习页状态不是 ready', built)
  const pages = Array.isArray(built.pages) ? built.pages : []
  const firstPage = pages.find((page) => page.status === 'ready')
  if (!firstPage) fail('复习页没有就绪页面', pages)
  record('deck build', `pages=${pages.length} job=${buildJobId}`)

  const pageId = Number(firstPage.id)
  const bundle = await call(`/decks/${deckId}/pages/${pageId}/bundle`)
  if (bundle?.schema_version !== '1.1') fail('bundle schema_version 不是 1.1', bundle)
  if (typeof bundle.html !== 'string' || !bundle.html.includes('<')) fail('bundle html 为空', bundle)
  if (typeof bundle.css !== 'string') fail('bundle css 缺失', bundle)
  record('page bundle', `bytes=${JSON.stringify(bundle).length}`)

  const answer = await call(`/decks/${deckId}/pages/${pageId}/messages`, {
    method: 'POST',
    body: { content: '用一句话说明 Cauchy-Riemann 方程的作用。', quote: '', block_text: '' },
  })
  if (!answer?.message_id) fail('页面问答未返回 message_id', answer)
  if (typeof answer.content !== 'string' || !answer.content.trim()) fail('页面问答内容为空', answer)
  const messages = await call(`/decks/${deckId}/pages/${pageId}/messages`)
  if (!Array.isArray(messages) || messages.length < 2) fail('页面问答消息未落库', messages)
  record('page chat', `messages=${messages.length}`)

  const beforeRebuild = await call(`/decks/${deckId}/pages/${pageId}`)
  const baseVersion = Number(beforeRebuild.current_version)
  const canceledRebuild = await call(`/decks/${deckId}/pages/${pageId}/rebuild`, {
    method: 'POST',
    body: { feedback: '冒烟测试取消' },
  })
  if (!Number(canceledRebuild?.job_id)) fail('单页重做未返回 job_id', canceledRebuild)
  const canceled = await call(`/decks/${deckId}/cancel`, { method: 'POST' })
  if (canceled?.status !== 'canceled') fail('取消构建未返回 canceled', canceled)
  const afterCancel = await call(`/decks/${deckId}/pages/${pageId}`)
  if (afterCancel?.status !== 'ready') fail('取消后旧页面不再可读', afterCancel)
  if (Number(afterCancel.current_version) !== baseVersion) fail('取消后页面版本不应变化', afterCancel)
  const stillReadable = await call(`/decks/${deckId}/pages/${pageId}/bundle`)
  if (stillReadable?.schema_version !== '1.1') fail('取消后旧 bundle 不可读', stillReadable)
  record('cancel keeps old page')

  const rebuild = await call(`/decks/${deckId}/pages/${pageId}/rebuild`, {
    method: 'POST',
    body: { feedback: '请补充一个更直观的例子' },
  })
  const rebuildJobId = Number(rebuild?.job_id)
  if (!rebuildJobId) fail('单页重做未返回 job_id', rebuild)
  const rebuildJob = await advanceUntil('/deck-jobs', rebuildJobId, deckTerminal, '单页重做')
  if (rebuildJob.status !== 'done') fail('单页重做未成功完成', rebuildJob)
  const afterRebuild = await call(`/decks/${deckId}/pages/${pageId}`)
  if (afterRebuild?.status !== 'ready') fail('重做后页面未就绪', afterRebuild)
  if (Number(afterRebuild.current_version) !== baseVersion + 1) {
    fail(`重做后版本号应 +1，期望 ${baseVersion + 1}`, afterRebuild)
  }
  const newBundle = await call(`/decks/${deckId}/pages/${pageId}/bundle`)
  if (newBundle?.schema_version !== '1.1') fail('重做后 bundle 不可读', newBundle)
  record('single page rebuild', `v${baseVersion} → v${baseVersion + 1}`)

  const decks = await call(`/workspaces/${workspaceId}/decks`)
  if (!Array.isArray(decks) || !decks.some((item) => Number(item.id) === deckId)) fail('复习页列表缺少新建项', decks)
  record('list decks')

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
