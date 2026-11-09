import { escapeHtml } from '../math.ts';
import type {
  FigureState,
  PlaneCircle,
  PlaneLabel,
  PlaneLine,
  PlanePath,
  PlanePoint,
  PlaneRing,
  PlaneView,
} from '../types.ts';

export const SVG_WIDTH = 320;
export const SVG_HEIGHT = 220;
const PAD_X = 22;
const PAD_Y = 16;

/** SVG 文本不能超出画布；靠右时自动改成右对齐，避免标签被裁掉。 */
function safeLabelX(x: number, preferredAnchor?: string): { x: number; anchor: string } {
  const anchor = preferredAnchor ?? (x > SVG_WIDTH * 0.72 ? 'end' : 'start');
  const min = anchor === 'end' ? 8 : 6;
  const max = SVG_WIDTH - 6;
  return { x: Math.min(max, Math.max(min, x)), anchor };
}

export interface PlaneMap {
  view: PlaneView;
  x: (value: number) => number;
  y: (value: number) => number;
  unit: (value: number) => number;
}

export function makeView(view: PlaneView): PlaneView {
  return { ...view };
}

export function computeView(parts: {
  points?: PlanePoint[];
  circles?: PlaneCircle[];
  lines?: PlaneLine[];
  states?: FigureState[];
  minSpan?: number;
}): PlaneView {
  const xs: number[] = [0];
  const ys: number[] = [0];
  for (const point of parts.points ?? []) {
    xs.push(point.x);
    ys.push(point.y);
  }
  for (const circle of parts.circles ?? []) {
    xs.push(circle.cx - circle.r, circle.cx + circle.r);
    ys.push(circle.cy - circle.r, circle.cy + circle.r);
  }
  for (const line of parts.lines ?? []) {
    xs.push(line.from[0], line.to[0]);
    ys.push(line.from[1], line.to[1]);
  }
  for (const state of parts.states ?? []) {
    for (const line of state.lines ?? []) {
      xs.push(line.from[0], line.to[0]);
      ys.push(line.from[1], line.to[1]);
    }
    for (const path of state.paths ?? []) {
      for (const point of path.points) {
        xs.push(point[0]);
        ys.push(point[1]);
      }
    }
    for (const ring of state.rings ?? []) {
      xs.push(ring.x - ring.r, ring.x + ring.r);
      ys.push(ring.y - ring.r, ring.y + ring.r);
    }
  }
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const spanX = Math.max(xMax - xMin, parts.minSpan ?? 4);
  const spanY = Math.max(yMax - yMin, parts.minSpan ?? 4);
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  xMin = Math.min(-1, cx - spanX / 2 - 0.7);
  xMax = Math.max(1, cx + spanX / 2 + 0.7);
  yMin = Math.min(-1, cy - spanY / 2 - 0.7);
  yMax = Math.max(1, cy + spanY / 2 + 0.7);
  return { xMin, xMax, yMin, yMax };
}

export function makeMap(view: PlaneView): PlaneMap {
  const width = SVG_WIDTH - PAD_X * 2;
  const height = SVG_HEIGHT - PAD_Y * 2;
  // 复平面必须等比例：圆才是圆、y=x 才是 45°；不足的一侧居中留白。
  const scale = Math.min(width / (view.xMax - view.xMin), height / (view.yMax - view.yMin));
  const usedWidth = (view.xMax - view.xMin) * scale;
  const usedHeight = (view.yMax - view.yMin) * scale;
  const originX = PAD_X + (width - usedWidth) / 2;
  const originY = PAD_Y + (height - usedHeight) / 2;
  const centerX = (view.xMin + view.xMax) / 2;
  const centerY = (view.yMin + view.yMax) / 2;
  const effectiveView = {
    xMin: centerX - width / scale / 2,
    xMax: centerX + width / scale / 2,
    yMin: centerY - height / scale / 2,
    yMax: centerY + height / scale / 2,
  };
  return {
    view: effectiveView,
    x: (value: number) => originX + (value - view.xMin) * scale,
    y: (value: number) => originY + (view.yMax - value) * scale,
    unit: (value: number) => value * scale,
  };
}

function niceStep(span: number): number {
  if (span <= 6) return 1;
  if (span <= 12) return 2;
  if (span <= 30) return 5;
  return 10;
}

export function renderGrid(map: PlaneMap): string {
  const { view } = map;
  const step = niceStep(Math.max(view.xMax - view.xMin, view.yMax - view.yMin));
  const lines: string[] = [];
  for (let x = Math.ceil(view.xMin / step) * step; x <= view.xMax; x += step) {
    if (Math.abs(x) < 0.001) continue;
    lines.push(
      `<line x1="${map.x(x).toFixed(2)}" y1="${PAD_Y}" x2="${map.x(x).toFixed(2)}" y2="${(SVG_HEIGHT - PAD_Y).toFixed(2)}" class="pg-fig-grid" />`,
    );
  }
  for (let y = Math.ceil(view.yMin / step) * step; y <= view.yMax; y += step) {
    if (Math.abs(y) < 0.001) continue;
    lines.push(
      `<line x1="${PAD_X}" y1="${map.y(y).toFixed(2)}" x2="${(SVG_WIDTH - PAD_X).toFixed(2)}" y2="${map.y(y).toFixed(2)}" class="pg-fig-grid" />`,
    );
  }
  return lines.join('');
}

export function renderAxes(map: PlaneMap): string {
  const { view } = map;
  const parts: string[] = [];
  if (view.yMin <= 0 && view.yMax >= 0) {
    parts.push(
      `<line x1="${PAD_X}" y1="${map.y(0).toFixed(2)}" x2="${(SVG_WIDTH - PAD_X).toFixed(2)}" y2="${map.y(0).toFixed(2)}" class="pg-fig-axis" />`,
    );
    parts.push(
      `<text x="${(SVG_WIDTH - PAD_X - 1).toFixed(2)}" y="${(map.y(0) + 14).toFixed(2)}" class="pg-fig-faint" font-size="9" text-anchor="end">Re</text>`,
    );
  }
  if (view.xMin <= 0 && view.xMax >= 0) {
    parts.push(
      `<line x1="${map.x(0).toFixed(2)}" y1="${PAD_Y}" x2="${map.x(0).toFixed(2)}" y2="${(SVG_HEIGHT - PAD_Y).toFixed(2)}" class="pg-fig-axis" />`,
    );
    parts.push(
      `<text x="${(map.x(0) + 4).toFixed(2)}" y="${(PAD_Y - 3).toFixed(2)}" class="pg-fig-faint" font-size="9">Im</text>`,
    );
  }
  if (view.xMin <= 0 && view.xMax >= 0 && view.yMin <= 0 && view.yMax >= 0) {
    parts.push(
      `<text x="${(map.x(0) - 4).toFixed(2)}" y="${(map.y(0) + 13).toFixed(2)}" class="pg-fig-faint" font-size="9" text-anchor="end">0</text>`,
    );
  }
  return parts.join('');
}

function normalOffset(x1: number, y1: number, x2: number, y2: number, distance: number): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  return [(dy / length) * distance, (-dx / length) * distance];
}

function arrowHead(map: PlaneMap, from: [number, number], to: [number, number]): string {
  const x1 = map.x(from[0]);
  const y1 = map.y(from[1]);
  const x2 = map.x(to[0]);
  const y2 = map.y(to[1]);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 5.2;
  const p1 = `${(x2 - size * Math.cos(angle - Math.PI / 6)).toFixed(2)},${(y2 - size * Math.sin(angle - Math.PI / 6)).toFixed(2)}`;
  const p2 = `${x2.toFixed(2)},${y2.toFixed(2)}`;
  const p3 = `${(x2 - size * Math.cos(angle + Math.PI / 6)).toFixed(2)},${(y2 - size * Math.sin(angle + Math.PI / 6)).toFixed(2)}`;
  return `<polygon points="${p1} ${p2} ${p3}" class="pg-fig-arrow" />`;
}

export function renderLine(map: PlaneMap, line: PlaneLine): string {
  const x1 = map.x(line.from[0]);
  const y1 = map.y(line.from[1]);
  const x2 = map.x(line.to[0]);
  const y2 = map.y(line.to[1]);
  const cls = line.dashed ? 'pg-fig-ink pg-fig-dashed' : 'pg-fig-ink';
  const parts = [
    `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${cls}" />`,
  ];
  if (line.arrow) parts.push(arrowHead(map, line.from, line.to));
  if (line.label) {
    const [ox, oy] = normalOffset(x1, y1, x2, y2, 13);
    // 箭头放在 70% 处避开起点；虚线参考线放在 35% 处避开终点箭头
    const t = line.dashed ? 0.35 : 0.7;
    const mx = x1 + (x2 - x1) * t + ox;
    const my = y1 + (y2 - y1) * t + oy;
    parts.push(
      `<text x="${Math.min(SVG_WIDTH - 18, Math.max(18, mx)).toFixed(2)}" y="${my.toFixed(2)}" class="pg-fig-muted" font-size="10" text-anchor="middle">${escapeHtml(line.label)}</text>`,
    );
  }
  return parts.join('');
}

export function renderPath(map: PlaneMap, path: PlanePath): string {
  if (path.points.length < 2) return '';
  const points = path.points.map((point) => [map.x(point[0]), map.y(point[1])] as const);
  const d = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0].toFixed(2)} ${point[1].toFixed(2)}`)
    .join(' ');
  const cls = path.dashed ? 'pg-fig-ink pg-fig-dashed' : 'pg-fig-ink';
  const parts = [`<path d="${d}" class="${cls}" />`];
  if (path.arrow) {
    const last = path.points[path.points.length - 1];
    const previous = path.points[path.points.length - 2];
    parts.push(arrowHead(map, previous, last));
  }
  if (path.label) {
    const last = points[points.length - 1];
    const previous = points[points.length - 2];
    const [ox, oy] = normalOffset(previous[0], previous[1], last[0], last[1], 13);
    parts.push(
      `<text x="${(last[0] + ox).toFixed(2)}" y="${(last[1] + oy).toFixed(2)}" class="pg-fig-muted" font-size="10" text-anchor="middle">${escapeHtml(path.label)}</text>`,
    );
  }
  return parts.join('');
}

export function renderPoint(map: PlaneMap, point: PlanePoint, index = 0): string {
  const cx = map.x(point.x);
  const cy = map.y(point.y);
  const kind = point.kind ?? 'point';
  const cls =
    kind === 'pole' ? 'pg-fig-invert' : kind === 'zero' ? 'pg-fig-panel pg-fig-ink' : 'pg-fig-ink-fill';
  const radius = kind === 'point' ? 3.2 : 4;
  const parts = [`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius}" class="${cls}" />`];
  if (point.label) {
    // 同一水平线上的多个点交错上下放标签，减少重叠
    const dx = point.labelDx ?? 8;
    const dy = point.labelDy ?? (index % 2 === 0 ? -8 : 14);
    const placed = safeLabelX(cx + dx, point.labelAnchor ?? (cx + dx > SVG_WIDTH * 0.72 ? 'end' : 'start'));
    parts.push(
      `<text x="${placed.x.toFixed(2)}" y="${(cy + dy).toFixed(2)}" font-size="10" text-anchor="${placed.anchor}">${escapeHtml(point.label)}</text>`,
    );
  }
  return parts.join('');
}

export function renderCircle(map: PlaneMap, circle: PlaneCircle): string {
  const cx = map.x(circle.cx);
  const cy = map.y(circle.cy);
  const radius = Math.abs(map.unit(circle.r));
  const cls = circle.dashed ? 'pg-fig-ink pg-fig-dashed' : 'pg-fig-ink';
  const parts = [
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" class="${cls}" fill="none" />`,
  ];
  if (circle.label) {
    const labelX = cx + radius * 0.75;
    const placed = safeLabelX(labelX);
    parts.push(
      `<text x="${placed.x.toFixed(2)}" y="${(cy - radius * 0.75 - 4).toFixed(2)}" text-anchor="${placed.anchor}" class="pg-fig-muted" font-size="10">${escapeHtml(circle.label)}</text>`,
    );
  }
  return parts.join('');
}

export function renderRing(map: PlaneMap, ring: PlaneRing): string {
  const cx = map.x(ring.x);
  const cy = map.y(ring.y);
  const radius = Math.abs(map.unit(ring.r));
  const cls = ring.dashed ? 'pg-fig-ink pg-fig-dashed' : 'pg-fig-ink';
  return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" class="${cls}" fill="none" />`;
}

export function renderLabel(map: PlaneMap, label: PlaneLabel): string {
  const tone = label.tone === 'muted' ? 'pg-fig-muted' : label.tone === 'faint' ? 'pg-fig-faint' : '';
  const placed = safeLabelX(map.x(label.x));
  return `<text x="${placed.x.toFixed(2)}" y="${map.y(label.y).toFixed(2)}" text-anchor="${placed.anchor}" class="${tone}" font-size="10">${escapeHtml(label.text)}</text>`;
}

export function renderStateGroup(map: PlaneMap, state: FigureState, index: number): string {
  if (!state) return '';
  const parts: string[] = [];
  for (const line of state.lines ?? []) parts.push(renderLine(map, line));
  for (const path of state.paths ?? []) parts.push(renderPath(map, path));
  for (const ring of state.rings ?? []) parts.push(renderRing(map, ring));
  for (const label of state.labels ?? []) parts.push(renderLabel(map, label));
  return `<g data-pg-state-group="${index}" data-pg-active="${index === 0}">${parts.join('')}</g>`;
}
