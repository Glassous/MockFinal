import { escapeHtml } from '../math.ts';
import type { ComplexPlaneFigure } from '../types.ts';
import {
  computeView,
  makeMap,
  renderAxes,
  renderCircle,
  renderGrid,
  renderLine,
  renderPoint,
  renderStateGroup,
  SVG_HEIGHT,
  SVG_WIDTH,
} from './plane-utils.ts';

export function renderComplexPlaneSvg(figure: ComplexPlaneFigure): string {
  const view = figure.view ?? computeView(figure);
  const map = makeMap(view);
  const parts: string[] = [];
  parts.push(renderGrid(map));
  parts.push(renderAxes(map));
  for (const line of figure.lines ?? []) parts.push(renderLine(map, line));
  for (const circle of figure.circles ?? []) parts.push(renderCircle(map, circle));
  for (const [index, point] of (figure.points ?? []).entries()) parts.push(renderPoint(map, point, index));
  figure.states.forEach((state, index) => parts.push(renderStateGroup(map, state, index)));

  return `<svg class="pg-figure-svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${escapeHtml(figure.caption ?? '复平面图示')}">
<title>${escapeHtml(figure.caption ?? '复平面图示')}</title>
${parts.join('\n')}
</svg>`;
}
