import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** 允许的时间戳偏差（秒），INTERNAL_API §2。 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type SignatureErrorCode = "STALE_TIMESTAMP" | "BAD_SIGNATURE" | "MISSING_SIGNATURE";

export type SignatureResult =
  | { ok: true; fingerprint: string }
  | { ok: false; code: SignatureErrorCode; detail: string };

/**
 * 签名串为 `HMAC-SHA256(token, "{timestamp}.{method}.{path}.{rawBody}")`；
 * method 统一大写，path 含查询串；必须基于原始请求体字节，不能在验签前反序列化再序列化。
 */
export function computeSignature(
  token: string,
  timestamp: string | number,
  method: string,
  path: string,
  rawBody: Buffer | string,
): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return createHmac("sha256", token)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.`)
    .update(body)
    .digest("hex");
}

/** 请求体指纹，用于 build_id 幂等的冲突检测。 */
export function fingerprintBody(rawBody: Buffer | string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return createHash("sha256").update(body).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifyOptions {
  token: string;
  timestamp: string | undefined;
  signature: string | undefined;
  method: string;
  /** 请求目标，含查询串。 */
  path: string;
  rawBody: Buffer;
  /** 当前时间（秒），测试可注入。 */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export function verifyRequestSignature(options: VerifyOptions): SignatureResult {
  const { token, timestamp, signature, method, path, rawBody } = options;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS;

  if (!timestamp || !signature) {
    return {
      ok: false,
      code: "MISSING_SIGNATURE",
      detail: "缺少 X-MF-Timestamp 或 X-MF-Signature 请求头。",
    };
  }
  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, code: "STALE_TIMESTAMP", detail: "X-MF-Timestamp 必须是 Unix 秒整数。" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) {
    return {
      ok: false,
      code: "STALE_TIMESTAMP",
      detail: "请求时间戳超出允许范围（±300 秒），请校准时钟后重试。",
    };
  }
  if (!token) {
    return {
      ok: false,
      code: "BAD_SIGNATURE",
      detail: "构建服务未配置共享密钥，拒绝请求。",
    };
  }
  const expected = computeSignature(token, timestamp, method, path, rawBody);
  if (!safeEqualHex(expected, signature.trim())) {
    return { ok: false, code: "BAD_SIGNATURE", detail: "请求签名校验失败。" };
  }
  return { ok: true, fingerprint: fingerprintBody(rawBody) };
}
