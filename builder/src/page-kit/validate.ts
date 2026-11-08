import { countCjk, FIT_MAX_CJK, isFiniteNumber, PAGE_LIMITS, ROLE_CHECK_RANGE, ROLE_MAX_BLOCKS, ROLE_MIN_BLOCKS, ROLE_MIN_CJK, ROLE_SCROLL } from './limits.js';
import { mathTexError } from './math.js';
import {
  PAGE_ROLES,
  type ContentIssue,
  type PageContent,
  type PageRole,
  type ScrollMode,
} from './types.js';

const CALL_OUT_KINDS = new Set(['definition', 'theorem', 'key', 'warn', 'pitfall', 'note']);
const BLOCK_TYPES = new Set(['prose', 'formula', 'callout', 'example', 'compare', 'table']);
const ID_PATTERN = /^[a-z0-9-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function issue(
  issues: ContentIssue[],
  path: string,
  code: string,
  message: string,
  severity: ContentIssue['severity'] = 'error',
): void {
  issues.push({ severity, code, path, message });
}

function validateText(
  issues: ContentIssue[],
  path: string,
  value: unknown,
  max: number,
  required = true,
): string {
  if (!isNonEmptyString(value)) {
    if (required) issue(issues, path, 'FIELD_REQUIRED', '必须是非空字符串');
    return '';
  }
  if (value.length > max) issue(issues, path, 'FIELD_TOO_LONG', `长度不得超过 ${max} 字`);
  return value;
}

function validateId(issues: ContentIssue[], path: string, value: unknown): void {
  if (value === undefined) return;
  if (!isNonEmptyString(value) || !ID_PATTERN.test(value)) {
    issue(issues, path, 'BLOCK_ID_INVALID', 'id 必须匹配 [a-z0-9-]+');
  }
}

function validatePlaneLine(
  issues: ContentIssue[],
  path: string,
  line: unknown,
): void {
  if (!isPlainObject(line)) {
    issue(issues, path, 'FIGURE_INVALID', '线段必须是对象');
    return;
  }
  const from = line.from;
  const to = line.to;
  for (const [name, pair] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !isFiniteNumber(pair[0]) ||
      !isFiniteNumber(pair[1])
    ) {
      issue(issues, `${path}.${name}`, 'FIGURE_INVALID', '坐标必须是 [number, number]');
    }
  }
  validateText(issues, `${path}.label`, line.label, 24, false);
  validateWidgetLabel(issues, `${path}.label`, line.label);
}

function validatePlanePath(
  issues: ContentIssue[],
  path: string,
  value: unknown,
): void {
  if (!isPlainObject(value)) {
    issue(issues, path, 'FIGURE_INVALID', '路径必须是对象');
    return;
  }
  const points = value.points;
  if (!Array.isArray(points) || points.length < 2) {
    issue(issues, `${path}.points`, 'FIGURE_INVALID', '路径至少需要 2 个点');
  } else {
    points.forEach((point, index) => {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !isFiniteNumber(point[0]) ||
        !isFiniteNumber(point[1])
      ) {
        issue(issues, `${path}.points[${index}]`, 'FIGURE_INVALID', '坐标必须是 [number, number]');
      }
    });
  }
  validateText(issues, `${path}.label`, value.label, 24, false);
  validateWidgetLabel(issues, `${path}.label`, value.label);
}

function validateWidgetLabel(issues: ContentIssue[], path: string, value: unknown): void {
  if (typeof value !== 'string' || !value) return;
  if (!value.includes('$') && !value.includes('\\')) return;
  issue(
    issues,
    path,
    'FIGURE_LABEL_TEX',
    '图示标注只能用普通 Unicode 文本（如 θ、z̄、2πi），不要写 $...$ 或 LaTeX 命令',
  );
}

function validateFigure(issues: ContentIssue[], figure: unknown, role: PageRole): void {  if (figure === undefined || figure === null) {
    if (role === 'mechanism') issue(issues, 'figure', 'FIGURE_REQUIRED', 'mechanism 页必须提供图示');
    return;
  }
  if (role === 'practice' || role === 'summary') {
    issue(issues, 'figure', 'FIGURE_NOT_ALLOWED', `${role} 页不应提供图示`);
  }
  if (!isPlainObject(figure)) {
    issue(issues, 'figure', 'FIGURE_INVALID', 'figure 必须是对象');
    return;
  }
  const kind = figure.kind;
  if (kind !== 'complex-plane' && kind !== 'annulus') {
    issue(issues, 'figure.kind', 'FIGURE_INVALID', 'kind 只能是 complex-plane / annulus');
  }
  validateText(issues, 'figure.caption', figure.caption, 60, true);
  validateText(issues, 'figure.takeaway', figure.takeaway, 100, true);

  const states = figure.states;
  if (!Array.isArray(states) || states.length < PAGE_LIMITS.minFigureStates || states.length > PAGE_LIMITS.maxFigureStates) {
    issue(
      issues,
      'figure.states',
      'FIGURE_STATES_INVALID',
      `图示状态必须为 ${PAGE_LIMITS.minFigureStates}–${PAGE_LIMITS.maxFigureStates} 个`,
    );
    return;
  }
  states.forEach((state, index) => {
    const path = `figure.states[${index}]`;
    if (!isPlainObject(state)) {
      issue(issues, path, 'FIGURE_INVALID', '状态必须是对象');
      return;
    }
    validateText(issues, `${path}.label`, state.label, 24, true);
    validateWidgetLabel(issues, `${path}.label`, state.label);
    validateText(issues, `${path}.note`, state.note, 160, false);
    const lines = Array.isArray(state.lines) ? state.lines : [];
    lines.forEach((line, lineIndex) => validatePlaneLine(issues, `${path}.lines[${lineIndex}]`, line));
    const paths = Array.isArray(state.paths) ? state.paths : [];
    paths.forEach((item, pathIndex) => validatePlanePath(issues, `${path}.paths[${pathIndex}]`, item));
    const labels = Array.isArray(state.labels) ? state.labels : [];
    labels.forEach((label, labelIndex) => {
      const labelPath = `${path}.labels[${labelIndex}]`;
      if (!isPlainObject(label)) {
        issue(issues, labelPath, 'FIGURE_INVALID', '标注必须是对象');
        return;
      }
      if (!isFiniteNumber(label.x) || !isFiniteNumber(label.y)) {
        issue(issues, labelPath, 'FIGURE_INVALID', '标注坐标必须是数字');
      }
      validateText(issues, `${labelPath}.text`, label.text, 30, true);
      validateWidgetLabel(issues, `${labelPath}.text`, label.text);
    });
    const rings = Array.isArray(state.rings) ? state.rings : [];
    rings.forEach((ring, ringIndex) => {
      const ringPath = `${path}.rings[${ringIndex}]`;
      if (!isPlainObject(ring)) {
        issue(issues, ringPath, 'FIGURE_INVALID', '高亮圈必须是对象');
        return;
      }
      if (!isFiniteNumber(ring.x) || !isFiniteNumber(ring.y) || !isFiniteNumber(ring.r) || ring.r <= 0) {
        issue(issues, ringPath, 'FIGURE_INVALID', '高亮圈需要有限坐标与正半径');
      }
    });
  });

  if (kind === 'complex-plane') {
    const view = figure.view;
    if (view !== undefined) {
      if (
        !isPlainObject(view) ||
        !isFiniteNumber(view.xMin) ||
        !isFiniteNumber(view.xMax) ||
        !isFiniteNumber(view.yMin) ||
        !isFiniteNumber(view.yMax) ||
        view.xMin >= view.xMax ||
        view.yMin >= view.yMax
      ) {
        issue(issues, 'figure.view', 'FIGURE_INVALID', 'view 必须是有效的 xMin<xMax、yMin<yMax');
      }
    }
    const points = Array.isArray(figure.points) ? figure.points : [];
    points.forEach((point, index) => {
      const pointPath = `figure.points[${index}]`;
      if (!isPlainObject(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
        issue(issues, pointPath, 'FIGURE_INVALID', '点必须有有限坐标');
        return;
      }
      if (point.kind !== undefined && !['point', 'pole', 'zero'].includes(String(point.kind))) {
        issue(issues, `${pointPath}.kind`, 'FIGURE_INVALID', 'kind 只能是 point / pole / zero');
      }
      validateText(issues, `${pointPath}.label`, point.label, 24, false);
      validateWidgetLabel(issues, `${pointPath}.label`, point.label);
      if (point.labelDx !== undefined && !isFiniteNumber(point.labelDx)) {
        issue(issues, `${pointPath}.labelDx`, 'FIGURE_INVALID', 'labelDx 必须是数字');
      }
      if (point.labelDy !== undefined && !isFiniteNumber(point.labelDy)) {
        issue(issues, `${pointPath}.labelDy`, 'FIGURE_INVALID', 'labelDy 必须是数字');
      }
      if (point.labelAnchor !== undefined && !['start', 'middle', 'end'].includes(String(point.labelAnchor))) {
        issue(issues, `${pointPath}.labelAnchor`, 'FIGURE_INVALID', 'labelAnchor 只能是 start / middle / end');
      }
    });
    const circles = Array.isArray(figure.circles) ? figure.circles : [];
    circles.forEach((circle, index) => {
      const circlePath = `figure.circles[${index}]`;
      if (
        !isPlainObject(circle) ||
        !isFiniteNumber(circle.cx) ||
        !isFiniteNumber(circle.cy) ||
        !isFiniteNumber(circle.r) ||
        circle.r <= 0
      ) {
        issue(issues, circlePath, 'FIGURE_INVALID', '圆需要有限圆心与正半径');
        return;
      }
      validateText(issues, `${circlePath}.label`, circle.label, 24, false);
      validateWidgetLabel(issues, `${circlePath}.label`, circle.label);
    });
    const lines = Array.isArray(figure.lines) ? figure.lines : [];
    lines.forEach((line, index) => validatePlaneLine(issues, `figure.lines[${index}]`, line));
  }

  if (kind === 'annulus') {
    if (!isFiniteNumber(figure.innerRadius) || figure.innerRadius <= 0) {
      issue(issues, 'figure.innerRadius', 'FIGURE_INVALID', 'innerRadius 必须是正数');
    }
    if (
      !isFiniteNumber(figure.outerRadius) ||
      !isFiniteNumber(figure.innerRadius) ||
      figure.outerRadius <= figure.innerRadius
    ) {
      issue(issues, 'figure.outerRadius', 'FIGURE_INVALID', 'outerRadius 必须大于 innerRadius');
    }
    const center = figure.center;
    if (
      center !== undefined &&
      (!Array.isArray(center) || center.length !== 2 || !isFiniteNumber(center[0]) || !isFiniteNumber(center[1]))
    ) {
      issue(issues, 'figure.center', 'FIGURE_INVALID', 'center 必须是 [number, number]');
    }
  }
}

function validateBlock(issues: ContentIssue[], block: unknown, index: number): void {
  const path = `blocks[${index}]`;
  if (!isPlainObject(block)) {
    issue(issues, path, 'BLOCK_INVALID', '内容块必须是对象');
    return;
  }
  const type = block.type;
  if (!BLOCK_TYPES.has(String(type))) {
    issue(issues, `${path}.type`, 'BLOCK_TYPE_INVALID', '未知内容块类型');
    return;
  }
  validateId(issues, `${path}.id`, block.id);
  validateText(issues, `${path}.title`, block.title, PAGE_LIMITS.maxCalloutTitle, false);

  if (type === 'prose') {
    const text = validateText(issues, `${path}.text`, block.text, 4000, true);
    if (text && countCjk(text) === 0) {
      issue(issues, `${path}.text`, 'BLOCK_TEXT_INVALID', 'prose 至少需要中文正文');
    }
  } else if (type === 'formula') {
    const tex = validateText(issues, `${path}.tex`, block.tex, 1000, true);
    if (tex) {
      const error = mathTexError(tex);
      if (error) issue(issues, `${path}.tex`, 'MATH_INVALID', `公式无法解析：${error}`);
    }
    if (block.display !== undefined && typeof block.display !== 'boolean') {
      issue(issues, `${path}.display`, 'BLOCK_INVALID', 'display 必须是布尔值');
    }
  } else if (type === 'callout') {
    if (!CALL_OUT_KINDS.has(String(block.kind))) {
      issue(issues, `${path}.kind`, 'CALLOUT_KIND_INVALID', '未知提示块类型');
    }
    validateText(issues, `${path}.text`, block.text, 1200, true);
  } else if (type === 'example') {
    validateText(issues, `${path}.problem`, block.problem, 1200, true);
    if (block.problemTex !== undefined) {
      const tex = validateText(issues, `${path}.problemTex`, block.problemTex, 1200, false);
      if (tex) {
        const error = mathTexError(tex);
        if (error) issue(issues, `${path}.problemTex`, 'MATH_INVALID', `公式无法解析：${error}`);
      }
    }
    validateText(issues, `${path}.answer`, block.answer, 800, true);
    validateText(issues, `${path}.pitfall`, block.pitfall, 400, false);
    const steps = Array.isArray(block.steps) ? block.steps : [];
    if (steps.length < PAGE_LIMITS.minExampleSteps || steps.length > PAGE_LIMITS.maxExampleSteps) {
      issue(
        issues,
        `${path}.steps`,
        'EXAMPLE_STEPS_INVALID',
        `例题步骤必须为 ${PAGE_LIMITS.minExampleSteps}–${PAGE_LIMITS.maxExampleSteps} 步`,
      );
    }
    steps.forEach((step, stepIndex) => {
      const stepPath = `${path}.steps[${stepIndex}]`;
      if (!isPlainObject(step)) {
        issue(issues, stepPath, 'EXAMPLE_STEP_INVALID', '步骤必须是对象');
        return;
      }
      validateText(issues, `${stepPath}.title`, step.title, 40, true);
      validateText(issues, `${stepPath}.text`, step.text, 1200, true);
      if (step.tex !== undefined) {
        const tex = validateText(issues, `${stepPath}.tex`, step.tex, 800, false);
        if (tex) {
          const error = mathTexError(tex);
          if (error) issue(issues, `${stepPath}.tex`, 'MATH_INVALID', `公式无法解析：${error}`);
        }
      }
    });
  } else if (type === 'compare') {
    const columns = Array.isArray(block.columns) ? block.columns : [];
    if (columns.length < 2 || columns.length > 3) {
      issue(issues, `${path}.columns`, 'COMPARE_INVALID', 'compare 需要 2–3 个对象');
    }
    columns.forEach((column, columnIndex) => {
      const columnPath = `${path}.columns[${columnIndex}]`;
      if (!isPlainObject(column)) {
        issue(issues, columnPath, 'COMPARE_INVALID', '对照列必须是对象');
        return;
      }
      validateText(issues, `${columnPath}.title`, column.title, 30, true);
      const items = Array.isArray(column.items) ? column.items : [];
      if (items.length < 2 || items.length > 6) {
        issue(issues, `${columnPath}.items`, 'COMPARE_INVALID', '每列 2–6 条');
      }
      items.forEach((item, itemIndex) =>
        validateText(issues, `${columnPath}.items[${itemIndex}]`, item, 160, true),
      );
    });
    validateText(issues, `${path}.verdict`, block.verdict, 200, false);
  } else if (type === 'table') {
    const headers = Array.isArray(block.headers) ? block.headers : [];
    if (headers.length < 2 || headers.length > 6) {
      issue(issues, `${path}.headers`, 'TABLE_INVALID', '表格需要 2–6 列');
    }
    headers.forEach((header, headerIndex) =>
      validateText(issues, `${path}.headers[${headerIndex}]`, header, 30, true),
    );
    const rows = Array.isArray(block.rows) ? block.rows : [];
    if (rows.length < 1 || rows.length > 6) {
      issue(issues, `${path}.rows`, 'TABLE_INVALID', '表格需要 1–6 行');
    }
    rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== headers.length) {
        issue(issues, `${path}.rows[${rowIndex}]`, 'TABLE_INVALID', '每行单元格数必须与表头一致');
        return;
      }
      row.forEach((cell, cellIndex) =>
        validateText(issues, `${path}.rows[${rowIndex}][${cellIndex}]`, cell, 120, true),
      );
    });
    validateText(issues, `${path}.caption`, block.caption, 120, false);
  }
}

function collectText(content: PageContent): string {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string') parts.push(value);
  };
  push(content.lede);
  push(content.title);
  for (const objective of content.objectives ?? []) push(objective);
  for (const block of content.blocks ?? []) {
    push((block as { title?: string }).title);
    if (block.type === 'prose') push(block.text);
    else if (block.type === 'formula') push(block.label);
    else if (block.type === 'callout') push(block.text);
    else if (block.type === 'example') {
      push(block.problem);
      push(block.answer);
      push(block.pitfall);
      for (const step of block.steps ?? []) {
        push(step.title);
        push(step.text);
      }
    } else if (block.type === 'compare') {
      for (const column of block.columns ?? []) {
        push(column.title);
        for (const item of column.items ?? []) push(item);
      }
      push(block.verdict);
    } else if (block.type === 'table') {
      for (const header of block.headers ?? []) push(header);
      for (const row of block.rows ?? []) for (const cell of row) push(cell);
      push(block.caption);
    }
  }
  for (const check of content.check ?? []) {
    push(check.question);
    for (const option of check.options ?? []) push(option);
    push(check.explanation);
  }
  if (content.summary) {
    for (const item of content.summary.key_points ?? []) push(item);
    for (const item of content.summary.misconceptions ?? []) push(item);
    push(content.summary.next);
  }
  if (content.figure) {
    push(content.figure.caption);
    push(content.figure.takeaway);
    for (const state of content.figure.states ?? []) {
      push(state.label);
      push(state.note);
    }
  }
  return parts.join('\n');
}

/** 校验内容模型；返回的问题既有 error 也有 warning，渲染器只拦截 error。 */
export function validateContent(content: unknown): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!isPlainObject(content)) {
    issue(issues, '', 'CONTENT_INVALID', 'content 必须是对象');
    return issues;
  }
  if (content.content_version !== '2.0') {
    issue(issues, 'content_version', 'CONTENT_VERSION', 'content_version 必须为 "2.0"');
  }
  const role = String(content.role ?? '');
  if (!PAGE_ROLES.includes(role as PageRole)) {
    issue(issues, 'role', 'ROLE_INVALID', '未知页面角色');
    return issues;
  }
  const pageRole = role as PageRole;
  validateText(issues, 'title', content.title, PAGE_LIMITS.maxTitle, true);
  validateText(issues, 'eyebrow', content.eyebrow, 40, false);
  validateText(issues, 'lede', content.lede, PAGE_LIMITS.maxLede, true);

  const objectives = Array.isArray(content.objectives) ? content.objectives : [];
  if (objectives.length < 1 || objectives.length > PAGE_LIMITS.maxObjectives) {
    issue(issues, 'objectives', 'OBJECTIVES_INVALID', `objectives 必须为 1–${PAGE_LIMITS.maxObjectives} 条`);
  }
  objectives.forEach((objective, index) =>
    validateText(issues, `objectives[${index}]`, objective, 80, true),
  );

  let scroll: ScrollMode = ROLE_SCROLL[pageRole];
  if (content.scroll !== undefined) {
    if (content.scroll !== 'flow' && content.scroll !== 'fit') {
      issue(issues, 'scroll', 'SCROLL_INVALID', 'scroll 只能是 flow / fit');
    } else {
      scroll = content.scroll;
    }
  }
  if (scroll !== ROLE_SCROLL[pageRole]) {
    issue(
      issues,
      'scroll',
      'SCROLL_MISMATCH',
      `${pageRole} 页默认滚动模式为 ${ROLE_SCROLL[pageRole]}，不要改成 ${scroll}`,
    );
  }

  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  const minBlocks = ROLE_MIN_BLOCKS[pageRole] ?? PAGE_LIMITS.minBlocks;
  const maxBlocks = ROLE_MAX_BLOCKS[pageRole] ?? PAGE_LIMITS.maxBlocks;
  if (blocks.length < minBlocks || blocks.length > maxBlocks) {
    issue(
      issues,
      'blocks',
      'BLOCKS_INVALID',
      `内容块必须为 ${minBlocks}–${maxBlocks} 个`,
    );
  }
  const ids = new Set<string>();
  blocks.forEach((block, index) => {
    validateBlock(issues, block, index);
    if (isPlainObject(block) && isNonEmptyString(block.id)) {
      if (ids.has(block.id)) issue(issues, `blocks[${index}].id`, 'BLOCK_ID_DUPLICATE', '内容块 id 重复');
      ids.add(block.id);
    }
  });

  validateFigure(issues, content.figure, pageRole);

  const checks = Array.isArray(content.check) ? content.check : [];
  const [minChecks, maxChecks] = ROLE_CHECK_RANGE[pageRole];
  if (checks.length < minChecks || checks.length > maxChecks) {
    issue(
      issues,
      'check',
      'CHECK_COUNT_INVALID',
      `${pageRole} 页需要 ${minChecks}–${maxChecks} 道检查题`,
    );
  }
  checks.forEach((check, index) => {
    const path = `check[${index}]`;
    if (!isPlainObject(check)) {
      issue(issues, path, 'CHECK_INVALID', '检查题必须是对象');
      return;
    }
    validateText(issues, `${path}.question`, check.question, 300, true);
    if (check.questionTex !== undefined) {
      const tex = validateText(issues, `${path}.questionTex`, check.questionTex, 1200, false);
      if (tex) {
        const error = mathTexError(tex);
        if (error) issue(issues, `${path}.questionTex`, 'MATH_INVALID', `公式无法解析：${error}`);
      }
    }
    const options = Array.isArray(check.options) ? check.options : [];
    if (options.length < 2 || options.length > 6) {
      issue(issues, `${path}.options`, 'CHECK_INVALID', '检查题需要 2–6 个选项');
    }
    options.forEach((option, optionIndex) =>
      validateText(issues, `${path}.options[${optionIndex}]`, option, 160, true),
    );
    if (
      typeof check.answer_index !== 'number' ||
      !Number.isInteger(check.answer_index) ||
      check.answer_index < 0 ||
      check.answer_index >= options.length
    ) {
      issue(issues, `${path}.answer_index`, 'CHECK_INVALID', 'answer_index 必须落在选项范围内');
    }
    validateText(issues, `${path}.explanation`, check.explanation, 600, true);
    if (check.objective_id !== undefined) {
      const match = /^o(\d+)$/.exec(String(check.objective_id));
      if (!match || Number(match[1]) < 1 || Number(match[1]) > objectives.length) {
        issue(
          issues,
          `${path}.objective_id`,
          'CHECK_OBJECTIVE_INVALID',
          `objective_id 必须指向 objectives（o1–o${Math.max(1, objectives.length)}）`,
        );
      }
    }
  });

  const summary = content.summary;
  if (summary !== undefined && summary !== null) {
    if (!isPlainObject(summary)) {
      issue(issues, 'summary', 'SUMMARY_INVALID', 'summary 必须是对象');
    } else {
      for (const key of ['key_points', 'misconceptions'] as const) {
        const list = summary[key];
        if (list !== undefined) {
          if (!Array.isArray(list)) {
            issue(issues, `summary.${key}`, 'SUMMARY_INVALID', `${key} 必须是数组`);
          } else {
            if (list.length > 6) issue(issues, `summary.${key}`, 'SUMMARY_INVALID', `${key} 最多 6 条`);
            list.forEach((item, index) =>
              validateText(issues, `summary.${key}[${index}]`, item, 120, true),
            );
          }
        }
      }
      validateText(issues, 'summary.next', summary.next, 120, false);
    }
  } else if (pageRole === 'summary') {
    issue(issues, 'summary', 'SUMMARY_REQUIRED', 'summary 页必须提供 summary.key_points');
  } else if (pageRole === 'practice') {
    issue(issues, 'summary', 'SUMMARY_RECOMMENDED', 'practice 页建议提供 summary.key_points', 'warning');
  }

  if (pageRole === 'summary') {
    const keyPoints = isPlainObject(summary) ? summary.key_points : undefined;
    if (!Array.isArray(keyPoints) || keyPoints.length < 1) {
      issue(issues, 'summary.key_points', 'SUMMARY_REQUIRED', 'summary 页至少需要 1 条 key_points');
    }
  }

  if (pageRole === 'mechanism') {
    const hasExample = blocks.some((block) => isPlainObject(block) && block.type === 'example');
    if (!hasExample) issue(issues, 'blocks', 'ROLE_REQUIREMENT', 'mechanism 页必须包含一个例题');
  }
  if (pageRole === 'worked_example') {
    const hasExample = blocks.some((block) => isPlainObject(block) && block.type === 'example');
    if (!hasExample) issue(issues, 'blocks', 'ROLE_REQUIREMENT', 'worked_example 页必须包含例题');
  }
  if (pageRole === 'compare') {
    const hasCompare = blocks.some((block) => isPlainObject(block) && block.type === 'compare');
    if (!hasCompare) issue(issues, 'blocks', 'ROLE_REQUIREMENT', 'compare 页必须包含对照块');
  }
  if (pageRole === 'concept') {
    const hasKey = blocks.some(
      (block) =>
        isPlainObject(block) &&
        block.type === 'callout' &&
        ['key', 'definition', 'theorem'].includes(String(block.kind)),
    );
    if (!hasKey) issue(issues, 'blocks', 'ROLE_REQUIREMENT', 'concept 页必须有核心结论/定义块');
  }
  if (['concept', 'mechanism', 'worked_example', 'compare'].includes(pageRole)) {
    const hasPitfall = blocks.some(
      (block) => isPlainObject(block) && block.type === 'callout' && block.kind === 'pitfall',
    );
    if (!hasPitfall) {
      issue(issues, 'blocks', 'ROLE_REQUIREMENT', `${pageRole} 页必须有一个易错提示`, 'warning');
    }
  }

  if (content.source_refs !== undefined) {
    if (!Array.isArray(content.source_refs)) {
      issue(issues, 'source_refs', 'SOURCE_REFS_INVALID', 'source_refs 必须是数组');
    } else {
      content.source_refs.forEach((ref, index) => {
        if (!isPlainObject(ref)) {
          issue(issues, `source_refs[${index}]`, 'SOURCE_REFS_INVALID', '来源必须是对象');
          return;
        }
        validateText(issues, `source_refs[${index}].quote`, ref.quote, 240, true);
      });
    }
  }

  if (content.meta !== undefined) {
    if (!isPlainObject(content.meta)) {
      issue(issues, 'meta', 'META_INVALID', 'meta 必须是对象');
    } else {
      validateText(issues, 'meta.exam', content.meta.exam, 60, false);
      validateText(issues, 'meta.source', content.meta.source, 120, false);
      if (
        content.meta.minutes !== undefined &&
        (!isFiniteNumber(content.meta.minutes) ||
          content.meta.minutes < 1 ||
          content.meta.minutes > 60)
      ) {
        issue(issues, 'meta.minutes', 'META_INVALID', 'minutes 必须是 1–60 的数字');
      }
    }
  }

  const cjk = countCjk(collectText(content as unknown as PageContent));
  const minCjk = ROLE_MIN_CJK[pageRole];
  if (cjk < minCjk) {
    issue(issues, 'blocks', 'CONTENT_SPARSE', `有效正文约 ${cjk} 字，低于 ${pageRole} 页下限 ${minCjk}`);
  }
  if (scroll === 'flow' && cjk > PAGE_LIMITS.maxProseCjk) {
    issue(issues, 'blocks', 'CONTENT_TOO_LONG', `正文约 ${cjk} 字，超过 flow 页建议上限`, 'warning');
  }
  if (scroll === 'fit') {
    const fitMax = FIT_MAX_CJK[pageRole] ?? PAGE_LIMITS.fitMaxCjk;
    if (cjk > fitMax) {
      issue(
        issues,
        'blocks',
        'CONTENT_TOO_LONG',
        `正文约 ${cjk} 字，超过 ${pageRole} 单屏页上限 ${fitMax}；请合并次要段落，保证 1280×720 单屏`,
      );
    }
  }

  return issues;
}

export function hasErrors(issues: ContentIssue[]): boolean {
  return issues.some((entry) => entry.severity === 'error');
}

export function describeIssues(issues: ContentIssue[]): string {
  return issues
    .map((entry) => `- [${entry.code}] ${entry.path}: ${entry.message}`)
    .join('\n');
}
