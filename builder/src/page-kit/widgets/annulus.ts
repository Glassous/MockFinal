import { escapeHtml } from '../math.js';
import type { AnnulusFigure } from '../types.js';
import {
  computeView,
  makeMap,
  renderCircle,
  renderPoint,
  renderStateGroup,
  SVG_HEIGHT,
  SVG_WIDTH,
} from './plane-utils.js';

function annulusPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
): string {
  return [
    `M ${(cx - outer).toFixed(2)} ${cy.toFixed(2)}`,
    `A ${outer.toFixed(2)} ${outer.toFixed(2)} 0 1 0 ${(cx + outer).toFixed(2)} ${cy.toFixed(2)}`,
    `A ${outer.toFixed(2)} ${outer.toFixed(2)} 0 1 0 ${(cx - outer).toFixed(2)} ${cy.toFixed(2)}`,
    'Z',
    `M ${(cx - inner).toFixed(2)} ${cy.toFixed(2)}`,
    `A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 1 1 ${(cx + inner).toFixed(2)} ${cy.toFixed(2)}`,
    `A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 1 1 ${(cx - inner).toFixed(2)} ${cy.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function renderAnnulusSvg(figure: AnnulusFigure, uid: string): string {
  const center = figure.center ?? [0, 0];
  const view =
    figure.innerRadius && figure.outerRadius
      ? computeView({
          points: figure.points,
          circles: [
            { cx: center[0], cy: center[1], r: figure.innerRadius },
            { cx: center[0], cy: center[1], r: figure.outerRadius },
          ],
          states: figure.states,
          minSpan: figure.outerRadius * 2 + 2,
        })
      : computeView({ points: figure.points, states: figure.states });
  const map = makeMap(view);
  const cx = map.x(center[0]);
  const cy = map.y(center[1]);
  const inner = Math.abs(map.unit(figure.innerRadius));
  const outer = Math.abs(map.unit(figure.outerRadius));
  const patternId = `pg-hatch-${uid}`;

  const parts: string[] = [
    `<defs>
<pattern id="${patternId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<line x1="0" y1="0" x2="0" y2="6" class="pg-fig-grid" />
</pattern>
</defs>`,
    `<path d="${annulusPath(cx, cy, inner, outer)}" fill="url(#${patternId})" fill-rule="evenodd" stroke="none" />`,
    renderCircle(map, { cx: center[0], cy: center[1], r: figure.outerRadius, label: '' }),
    renderCircle(map, { cx: center[0], cy: center[1], r: figure.innerRadius, dashed: true, label: '' }),
  ];
  for (const [index, point] of (figure.points ?? []).entries()) parts.push(renderPoint(map, point, index));
  figure.states.forEach((state, index) => parts.push(renderStateGroup(map, state, index)));

  return `<svg class="pg-figure-svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${escapeHtml(figure.caption ?? '收敛域图示')}">
<title>${escapeHtml(figure.caption ?? '收敛域图示')}</title>
${parts.join('\n')}
</svg>`;
}
