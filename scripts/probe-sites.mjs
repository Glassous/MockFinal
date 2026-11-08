#!/usr/bin/env node
/**
 * Phase 0 平台能力探测。需要：
 *   SITES_BASE_URL=https://<site>  PROBE_TOKEN=<secret>
 * 站点必须已发布含 /api/health/probe 的版本，并在 Sites Secrets 配置 PROBE_TOKEN。
 *
 * 输出可回填到 docs/serverless/PLATFORM_LIMITS.md 的结果。
 * 探测完成后删除 functions/routes/probe.ts 的注册与 PROBE_TOKEN。
 */

const base = (process.env.SITES_BASE_URL || '').replace(/\/+$/, '')
const token = process.env.PROBE_TOKEN || ''
if (!base || !token) {
  console.error('需要 SITES_BASE_URL 与 PROBE_TOKEN')
  process.exit(2)
}

const API = `${base}/functions/v1/app/api`
const headers = { 'x-probe-token': token }

async function timedFetch(url, init, timeoutMs) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.arrayBuffer()
    return { status: response.status, elapsed: Date.now() - started, bytes: body.byteLength, text: new TextDecoder().decode(body.slice(0, 300)) }
  } catch (error) {
    return { status: 0, elapsed: Date.now() - started, error: error?.name || String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function log(section, result) {
  console.log(`${section} ${JSON.stringify(result)}`)
}

async function probeTimeout() {
  const steps = [5_000, 15_000, 30_000, 60_000, 90_000]
  let lastOk = 0
  for (const ms of steps) {
    const result = await timedFetch(`${API}/health/probe?ms=${ms}`, { headers }, ms + 20_000)
    log(`timeout.ms=${ms}`, { status: result.status, elapsed: result.elapsed, error: result.error })
    if (result.status !== 200 || !result.text.includes('"ok":true')) {
      console.log(`timeout.first_failure_ms=${ms} last_ok_ms=${lastOk}`)
      return { lastOk, firstFailure: ms }
    }
    lastOk = ms
  }
  console.log(`timeout.all_ok_up_to_ms=${lastOk}`)
  return { lastOk, firstFailure: null }
}

async function probeRequestBody() {
  const sizes = [100 * 1024, 1024 * 1024, 6 * 1024 * 1024, 8 * 1024 * 1024]
  let lastOk = 0
  for (const size of sizes) {
    const body = new Uint8Array(size)
    const result = await timedFetch(`${API}/health/probe/echo`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body,
    }, 60_000)
    log(`request_bytes=${size}`, { status: result.status, elapsed: result.elapsed, error: result.error, text: result.text.slice(0, 120) })
    if (result.status !== 200) {
      console.log(`request.max_ok_bytes=${lastOk} first_failure_bytes=${size}`)
      return { lastOk, firstFailure: size }
    }
    lastOk = size
  }
  console.log(`request.max_ok_bytes=${lastOk}`)
  return { lastOk, firstFailure: null }
}

async function probeResponseBody() {
  const sizes = [1024 * 1024, 5 * 1024 * 1024]
  let lastOk = 0
  for (const size of sizes) {
    const result = await timedFetch(`${API}/health/probe/bytes?n=${size}`, { headers }, 60_000)
    log(`response_bytes=${size}`, { status: result.status, received: result.bytes, elapsed: result.elapsed, error: result.error })
    if (result.status !== 200 || result.bytes !== size) {
      console.log(`response.max_ok_bytes=${lastOk} first_failure_bytes=${size}`)
      return { lastOk, firstFailure: size }
    }
    lastOk = size
  }
  console.log(`response.max_ok_bytes=${lastOk}`)
  return { lastOk, firstFailure: null }
}

const summary = {
  base,
  timeout: await probeTimeout(),
  request: await probeRequestBody(),
  response: await probeResponseBody(),
}
console.log('SUMMARY', JSON.stringify(summary, null, 2))
