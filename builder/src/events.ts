import type { BuildEvent, BuildEventType } from "./types.js";

/** 单事件文本上限 4 KB（INTERNAL_API §3.3）。 */
export const MAX_EVENT_TEXT_BYTES = 4096;
/** 每构建事件总数上限。 */
export const MAX_EVENTS = 200;

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let result = "";
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    result += char;
    bytes += size;
  }
  return `${result}…`;
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      result[key] = truncateUtf8(value, MAX_EVENT_TEXT_BYTES);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    } else {
      try {
        result[key] = JSON.parse(truncateUtf8(JSON.stringify(value), MAX_EVENT_TEXT_BYTES));
      } catch {
        result[key] = "[unserializable]";
      }
    }
  }
  return result;
}

/**
 * 进程内事件日志：seq 从 1 递增；超过上限后折叠为一条 stage 摘要，
 * 后续事件只累加折叠计数，避免无限增长与前端刷屏。
 */
export class EventLog {
  private events: BuildEvent[] = [];
  private nextSeq = 1;
  private folded = 0;
  private foldEventIndex = -1;

  get cursor(): number {
    return this.nextSeq - 1;
  }

  get size(): number {
    return this.events.length;
  }

  add(type: BuildEventType, payload: Record<string, unknown> = {}): BuildEvent | undefined {
    // 预留最后一条作为折叠摘要，保证总条数不超过 MAX_EVENTS。
    if (this.foldEventIndex >= 0) {
      this.folded += 1;
      const foldedEvent = this.events[this.foldEventIndex];
      if (foldedEvent) {
        foldedEvent.payload = {
          text: `事件过多，已折叠 ${this.folded} 条后续输出。构建仍在继续，请查看最终状态。`,
          folded: this.folded,
        };
      }
      return undefined;
    }
    const event: BuildEvent = {
      seq: this.nextSeq,
      type,
      payload: sanitizePayload(payload),
      at: new Date().toISOString(),
    };
    this.nextSeq += 1;
    this.events.push(event);
    if (this.events.length >= MAX_EVENTS - 1) {
      this.foldEventIndex = this.nextSeq;
      const foldEvent: BuildEvent = {
        seq: this.nextSeq,
        type: "stage",
        payload: { text: "事件较多，后续输出将折叠显示。" },
        at: new Date().toISOString(),
      };
      this.nextSeq += 1;
      this.events.push(foldEvent);
      this.foldEventIndex = this.events.length - 1;
    }
    return event;
  }

  listAfter(afterSeq: number): { events: BuildEvent[]; nextSeq: number } {
    const from = Number.isFinite(afterSeq) && afterSeq > 0 ? Math.trunc(afterSeq) : 0;
    const events = this.events.filter((event) => event.seq > from);
    return { events, nextSeq: this.cursor };
  }

  all(): readonly BuildEvent[] {
    return this.events;
  }
}
