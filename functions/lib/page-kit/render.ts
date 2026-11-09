import { escapeHtml, renderInline, renderMath, renderParagraphs, stripInline } from './math.ts';
import { ROLE_SCROLL } from './limits.ts';
import { hasErrors, validateContent } from './validate.ts';
import { renderAnnulusSvg } from './widgets/annulus.ts';
import { renderComplexPlaneSvg } from './widgets/complex-plane.ts';
import {
  PAGE_KIT_VERSION,
  PAGE_THEMES,
  PageContentError,
  ROLE_LABELS,
  type CalloutBlock,
  type CheckSpec,
  type ContentBlock,
  type ContentIssue,
  type ExampleBlock,
  type FigureSpec,
  type PageContent,
  type PageTheme,
  type RenderOptions,
  type RenderResult,
  type SourceRef,
  type SummarySpec,
} from './types.ts';

const CALLOUT_LABELS: Record<CalloutBlock['kind'], string> = {
  definition: '定义',
  theorem: '定理',
  key: '核心',
  warn: '注意',
  pitfall: '易错',
  note: '备注',
};

interface ChainStep {
  id: string;
  title: string;
  block_id: string;
  target?: string;
}

function withIds(content: PageContent): PageContent {
  const blocks = content.blocks.map((block, index) => ({
    ...block,
    id: `b${index + 1}`,
  })) as PageContent['blocks'];
  return { ...content, blocks };
}

function blockTitle(block: ContentBlock): string {
  if ('title' in block && typeof block.title === 'string' && block.title.trim()) return block.title;
  switch (block.type) {
    case 'prose':
      return '讲解';
    case 'formula':
      return block.label ?? '公式';
    case 'callout':
      return CALLOUT_LABELS[block.kind];
    case 'example':
      return block.label ?? '例题';
    case 'compare':
      return '对照';
    case 'table':
      return '速查表';
    default:
      return '讲解';
  }
}

function pickChain(content: PageContent): ChainStep[] {
  const example = content.blocks.find((block): block is ExampleBlock => block.type === 'example');
  if (content.role === 'worked_example' && example) {
    const exampleId = example.id ?? 'b1';
    return example.steps.map((step, index) => ({
      id: `c${index + 1}`,
      title: step.title,
      block_id: exampleId,
      target: `${exampleId}-s${index + 1}`,
    }));
  }
  return content.blocks.slice(0, 5).map((block, index) => ({
    id: `c${index + 1}`,
    title: blockTitle(block),
    block_id: block.id ?? `b${index + 1}`,
  }));
}

function blockAria(block: ContentBlock): string {
  return escapeHtml(stripInline(blockTitle(block)) || '内容块');
}

function renderBlock(block: ContentBlock): string {
  const id = block.id ?? 'b1';
  if (block.type === 'prose') {
    return `<section class="pg-block pg-prose" data-mp-block="${id}" aria-label="${blockAria(block)}">
${block.title ? `<h2 class="pg-prose-title">${renderInline(block.title)}</h2>` : ''}
${renderParagraphs(block.text)}
</section>`;
  }
  if (block.type === 'formula') {
    const display = block.display !== false;
    return `<section class="pg-block pg-formula-block" data-mp-block="${id}" aria-label="${blockAria(block)}">
${block.title ? `<p class="pg-label">${renderInline(block.title)}</p>` : ''}
<div class="pg-formula-wrap"><div class="pg-formula">${renderMath(block.tex, display)}${block.label ? `<span class="pg-formula-label">${renderInline(block.label)}</span>` : ''}</div><span class="pg-formula-hint">左右滑动查看完整公式</span></div>
</section>`;
  }
  if (block.type === 'callout') {
    return `<section class="pg-block pg-callout pg-callout-${block.kind}" data-mp-block="${id}" aria-label="${blockAria(block)}">
<p class="pg-label">${CALLOUT_LABELS[block.kind]}</p>
${block.title ? `<h2>${renderInline(block.title)}</h2>` : ''}
${renderParagraphs(block.text)}
</section>`;
  }
  if (block.type === 'example') {
    const steps = block.steps
      .map(
        (step, index) => `<li class="pg-step" id="${id}-s${index + 1}">
<span class="pg-step-index" aria-hidden="true">${index + 1}</span>
<div class="pg-step-body">
<h3 class="pg-step-title">${renderInline(step.title)}</h3>
<p class="pg-step-text">${renderInline(step.text)}</p>
${step.tex ? `<div class="pg-formula-wrap"><div class="pg-formula pg-step-formula">${renderMath(step.tex, true)}</div><span class="pg-formula-hint">左右滑动查看完整公式</span></div>` : ''}
</div>
</li>`,
      )
      .join('\n');
    const problemTex = block.problemTex
      ? `<div class="pg-formula-wrap"><div class="pg-formula pg-example-formula">${renderMath(block.problemTex, true)}</div><span class="pg-formula-hint">左右滑动查看完整公式</span></div>`
      : '';
    return `<section class="pg-block pg-example" data-mp-block="${id}" aria-label="${escapeHtml(stripInline(block.label ?? '例题'))}">
<p class="pg-label">${renderInline(block.label ?? '例题')}</p>
<p class="pg-example-problem">${renderInline(block.problem)}</p>
${problemTex}
<ol class="pg-steps">
${steps}
</ol>
<div class="pg-answer"><span class="pg-answer-label">答案</span><div>${renderParagraphs(block.answer)}</div></div>
${block.pitfall ? `<p class="pg-pitfall"><strong>易错：</strong>${renderInline(block.pitfall)}</p>` : ''}
</section>`;
  }
  if (block.type === 'compare') {
    const columns = block.columns
      .map(
        (column) => `<div class="pg-compare-col">
<h3>${renderInline(column.title)}</h3>
<ul>${column.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>
</div>`,
      )
      .join('\n');
    return `<section class="pg-block pg-compare" data-mp-block="${id}" aria-label="${blockAria(block)}">
${block.title ? `<p class="pg-label">${renderInline(block.title)}</p>` : ''}
<div class="pg-compare-grid">
${columns}
</div>
${block.verdict ? `<p class="pg-verdict">${renderInline(block.verdict)}</p>` : ''}
</section>`;
  }
  if (block.type === 'table') {
    const head = block.headers.map((header) => `<th scope="col">${renderInline(header)}</th>`).join('');
    const rows = block.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
      .join('\n');
    return `<section class="pg-block pg-table-block" data-mp-block="${id}" aria-label="${blockAria(block)}">
${block.title ? `<p class="pg-label">${renderInline(block.title)}</p>` : ''}
<table class="pg-table">
${block.caption ? `<caption>${renderInline(block.caption)}</caption>` : ''}
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
  }
  return '';
}

function renderCheck(check: CheckSpec, index: number): string {
  const options = check.options
    .map((option, optionIndex) => {
      const correct = optionIndex === check.answer_index;
      return `<button type="button" class="pg-option" data-pg-option${correct ? ' data-pg-correct="true"' : ''}>
<span class="pg-option-key" aria-hidden="true">${String.fromCharCode(65 + optionIndex)}</span>
<span>${renderInline(option)}</span>
</button>`;
    })
    .join('\n');
  const questionTex = check.questionTex
    ? `<div class="pg-formula-wrap"><div class="pg-formula pg-check-formula">${renderMath(check.questionTex, true)}</div><span class="pg-formula-hint">左右滑动查看完整公式</span></div>`
    : '';
  return `<section class="pg-block pg-check" data-pg-check data-mp-block="q${index + 1}" aria-label="随堂检查">
<p class="pg-label">随堂检查${check.id ? ` · ${escapeHtml(check.id)}` : ''}</p>
<p class="pg-question">${renderInline(check.question)}</p>
${questionTex}
<div class="pg-options">
${options}
</div>
<p class="pg-check-result" data-pg-result aria-live="polite" hidden></p>
<p class="pg-explanation" data-pg-explanation aria-live="polite" hidden>${renderInline(check.explanation)}</p>
</section>`;
}

function renderSummary(summary: SummarySpec): string {
  const cards: string[] = [];
  if (summary.key_points?.length) {
    cards.push(`<div class="pg-summary-card"><h3>记住</h3><ul>${summary.key_points.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul></div>`);
  }
  if (summary.misconceptions?.length) {
    cards.push(`<div class="pg-summary-card"><h3>易错</h3><ul>${summary.misconceptions.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul></div>`);
  }
  if (summary.next) {
    cards.push(`<div class="pg-summary-card"><h3>下一步</h3><p class="pg-step-text">${renderInline(summary.next)}</p></div>`);
  }
  return `<section class="pg-block pg-summary" data-mp-block="summary" aria-label="本页小结">
<div class="pg-summary-grid">
${cards.join('\n')}
</div>
</section>`;
}

function renderFigure(figure: FigureSpec, pageId: string): string {
  const states = figure.states;
  const uid = pageId.replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'page';
  const svg =
    figure.kind === 'complex-plane' ? renderComplexPlaneSvg(figure) : renderAnnulusSvg(figure, uid);
  const notes = states
    .map(
      (state, index) =>
        `<p class="pg-figure-note" data-pg-note="${index}"${index === 0 ? '' : ' hidden'}>${renderInline(state.note ?? state.label)}</p>`,
    )
    .join('\n');
  return `<figure class="pg-figure" data-pg-figure data-pg-states="${states.length}" data-pg-figure-state="0" aria-label="${escapeHtml(figure.caption ?? '图示')}">
<div class="pg-figure-head">
<p class="pg-figure-label">图示</p>
<div class="pg-figure-controls">
<button type="button" class="pg-btn pg-btn-sm" data-pg-action="figure-prev" aria-label="上一步">‹</button>
<span class="pg-figure-state" data-pg-figure-state-label>1/${states.length}</span>
<button type="button" class="pg-btn pg-btn-sm" data-pg-action="figure-next" aria-label="下一步">›</button>
</div>
</div>
${svg}
<div class="pg-figure-notes" aria-live="polite">
${notes}
</div>
<figcaption class="pg-figure-caption">${renderInline(figure.caption ?? '')}</figcaption>
<p class="pg-figure-takeaway">${renderInline(figure.takeaway ?? '')}</p>
</figure>`;
}

function renderQuickfacts(content: PageContent): string {
  const objectives = content.objectives.map((item) => `<li>${renderInline(item)}</li>`).join('');
  const keyPoints =
    content.role !== 'summary' && content.summary?.key_points?.length
      ? `<p class="pg-label">记住</p><ul>${content.summary.key_points.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`
      : '';
  const misconceptions =
    content.role !== 'summary' && content.summary?.misconceptions?.length
      ? `<p class="pg-label">易错</p><ul>${content.summary.misconceptions.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`
      : '';
  const example = content.blocks.find((block): block is ExampleBlock => block.type === 'example');
  const answer =
    content.role !== 'summary' && example?.answer
      ? `<p class="pg-label">答案速记</p><p class="pg-quick-answer">${renderInline(example.answer)}</p>`
      : '';
  const next =
    content.role !== 'summary' && content.summary?.next
      ? `<p class="pg-label">下一步</p><p class="pg-quick-answer">${renderInline(content.summary.next)}</p>`
      : '';
  return `<section class="pg-quickfacts">
<p class="pg-label">本页目标</p>
<ul>${objectives}</ul>
${keyPoints}
${misconceptions}
${answer}
${next}
</section>`;
}

function mapContentSourceRefs(content: PageContent): Array<Record<string, unknown>> {
  return (content.source_refs ?? []).map((ref) => ({
    material_id: typeof ref.material_id === 'number' ? ref.material_id : 0,
    section_id: typeof ref.section_id === 'number' ? ref.section_id : 0,
    quote: ref.quote,
    ...(ref.heading ? { heading: ref.heading } : {}),
  }));
}

function mapOptionSourceRefs(options: RenderOptions): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const ref of options.sourceRefs ?? []) {
    const quote = String(ref.quote ?? ref.text ?? '').trim();
    if (!quote) continue;
    result.push({
      material_id: typeof ref.material_id === 'number' ? ref.material_id : 0,
      section_id: typeof ref.section_id === 'number' ? ref.section_id : 0,
      quote: quote.slice(0, 200),
      ...(ref.heading ? { heading: String(ref.heading) } : {}),
    });
  }
  return result;
}

function footerSource(
  content: PageContent,
  manifestRefs: Array<Record<string, unknown>>,
): string {
  const refs: Array<{ heading?: string; quote?: string }> = [];
  for (const ref of content.source_refs ?? []) refs.push(ref);
  if (refs.length === 0) {
    for (const ref of manifestRefs) {
      refs.push({
        heading: typeof ref.heading === 'string' ? ref.heading : undefined,
        quote: typeof ref.quote === 'string' ? ref.quote : undefined,
      });
    }
  }
  if (refs.length === 0) return '依据：课程资料整理';
  const first = refs[0] as SourceRef;
  const quote = String(first.quote ?? '').replace(/\s+/g, ' ').slice(0, 48);
  const head = first.heading ? `${first.heading} · ` : '';
  const more = refs.length > 1 ? ` 等 ${refs.length} 条` : '';
  return `依据：${escapeHtml(head)}${escapeHtml(quote)}${more}`;
}

function buildTeaching(
  content: PageContent,
  chain: ChainStep[],
  example: ExampleBlock | undefined,
  checks: CheckSpec[],
): Record<string, unknown> {
  const teaching: Record<string, unknown> = {
    version: '1.0',
    role: content.role,
    objectives: content.objectives.map((item) => stripInline(item)),
    prerequisites: (content.prerequisites ?? []).map((item) => stripInline(item)),
    hook: stripInline(content.lede ?? ''),
    chain: chain.map((step) => ({
      id: step.id,
      title: stripInline(step.title),
      block_id: step.block_id,
    })),
    check: checks.map((check, index) => ({
      id: check.id ?? `q${index + 1}`,
      objective_id: check.objective_id ?? 'o1',
      question: stripInline(check.question),
      options: check.options.map((option) => stripInline(option)),
      answer_index: check.answer_index,
      explanation: stripInline(check.explanation),
    })),
    scroll: content.scroll ?? ROLE_SCROLL[content.role],
    content_version: '2.0',
  };
  if (example) {
    teaching.worked_example = {
      problem: stripInline(example.problem),
      steps: example.steps.map((step, index) => ({
        id: `s${index + 1}`,
        title: stripInline(step.title),
        body: `${stripInline(step.text)}${step.tex ? `\n\n$$${step.tex}$$` : ''}`,
      })),
      answer: stripInline(example.answer),
      ...(example.pitfall ? { common_error: stripInline(example.pitfall) } : {}),
    };
  }
  if (content.summary) {
    teaching.summary = {
      key_points: (content.summary.key_points ?? []).map((item) => stripInline(item)),
      misconceptions: (content.summary.misconceptions ?? []).map((item) => stripInline(item)),
      ...(content.summary.next ? { next: stripInline(content.summary.next) } : {}),
    };
  }
  return teaching;
}

/**
 * 把 PageContent 渲染为 bundle 的 html/css/js + manifest。
 * css/js 为空：排版与交互全部由 shell 注入的 page-kit 2.0 提供。
 * 内容有 error 时抛 PageContentError；warning 随 issues 返回。
 */
export function renderPage(contentInput: unknown, options: RenderOptions): RenderResult {
  const issues: ContentIssue[] = validateContent(contentInput);
  if (hasErrors(issues)) throw new PageContentError(issues);
  const content = withIds(contentInput as PageContent);
  if (!PAGE_THEMES.includes(options.theme)) {
    throw new PageContentError([
      {
        severity: 'error',
        code: 'THEME_INVALID',
        path: 'theme',
        message: `theme 必须是 ${PAGE_THEMES.join(' / ')}`,
      },
    ]);
  }
  const role = content.role;
  const theme: PageTheme = options.theme;
  const scroll = content.scroll ?? ROLE_SCROLL[role];
  const example = content.blocks.find((block): block is ExampleBlock => block.type === 'example');
  const checks = content.check ?? [];
  const chain = pickChain(content);
  const minutes = Math.max(1, Math.round(options.estimatedMinutes ?? content.meta?.minutes ?? 8));
  const manifestRefs = options.sourceRefs?.length
    ? mapOptionSourceRefs(options)
    : mapContentSourceRefs(content);
  const sourceText = footerSource(content, manifestRefs);
  const sourceLabel =
    content.meta?.source ||
    (content.source_refs?.[0]?.heading ?? (manifestRefs[0]?.heading as string | undefined)) ||
    '';

  const figureHtml = content.figure ? renderFigure(content.figure, options.pageId) : '';
  const checkHtml = checks.map(renderCheck).join('\n');
  const summaryHtml = role === 'summary' && content.summary ? renderSummary(content.summary) : '';
  const blocksHtml = content.blocks.map(renderBlock).join('\n');
  const quickfacts = renderQuickfacts(content);
  const navLabel = role === 'worked_example' ? '解题路线' : '本页路线';
  const nav = `<nav class="pg-outline" aria-label="${navLabel}">
<p class="pg-outline-label">${navLabel}</p>
<ol>
${chain
  .map(
    (step, index) => `<li><button type="button" class="pg-outline-link" data-pg-action="goto" data-pg-goto="${step.target ?? step.block_id}">
<span class="pg-outline-index">${String(index + 1).padStart(2, '0')}</span>
<span>${renderInline(step.title)}</span>
</button></li>`,
  )
  .join('\n')}
</ol>
</nav>`;

  const metaItems = [
    ROLE_LABELS[role],
    `约 ${minutes} 分钟`,
    ...(content.meta?.exam ? [content.meta.exam] : []),
    ...(sourceLabel ? [sourceLabel] : []),
  ];

  const html = `<div class="pg-page pg-role-${role}" data-pg-theme="${theme}" data-pg-scroll="${scroll}" data-pg-role="${role}" data-pg-title="${escapeHtml(content.title)}">
<header class="pg-head">
<p class="pg-eyebrow">${escapeHtml(stripInline(content.eyebrow ?? ROLE_LABELS[role]))}</p>
<h1 class="pg-title">${renderInline(content.title)}</h1>
<p class="pg-lede">${renderInline(content.lede ?? '')}</p>
<ul class="pg-meta">
${metaItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')}
</ul>
</header>
${nav}
<main class="pg-flow">
${blocksHtml}
${checkHtml}
</main>
<aside class="pg-rail" aria-label="图示与速查">
${figureHtml}
${role === 'summary' ? summaryHtml : ''}
${quickfacts}
</aside>
<footer class="pg-foot">
<p class="pg-source">${sourceText}</p>
<div class="pg-controls">
<button type="button" class="pg-btn" data-pg-action="prev">上一页</button>
<button type="button" class="pg-btn" data-pg-action="reset">重置</button>
<button type="button" class="pg-btn pg-btn-primary" data-pg-action="next">下一页</button>
</div>
</footer>
</div>`;

  const interactions: Array<Record<string, unknown>> = [];
  if (content.figure) {
    interactions.push({
      id: 'figure',
      type: 'step',
      label: '图示步骤',
      smoke: {
        action: 'click',
        selector: "[data-pg-action='figure-next']",
        expect: '[data-pg-figure-state="1"]',
      },
    });
  }
  if (checks.length > 0) {
    interactions.push({
      id: 'check',
      type: 'retrieve',
      label: '随堂检查',
      smoke: {
        action: 'click',
        selector: '[data-pg-option]',
        expect: '[data-pg-check-state="answered"]',
      },
    });
  }
  if (interactions.length === 0) {
    interactions.push({ id: 'none', type: 'none', label: '阅读页', smoke: null });
  }

  const assistant = {
    summary: stripInline(content.lede ?? content.title),
    key_facts: Array.from(
      new Set([
        ...content.objectives.map((item) => stripInline(item)),
        ...(content.summary?.key_points ?? []).map((item) => stripInline(item)),
      ]),
    ).slice(0, 5),
    suggested_questions: [
      `${stripInline(content.title)}的关键步骤是什么？`,
      `${stripInline(content.objectives[0] ?? '本页重点')}在考试里怎么考？`,
      '这道例题最容易错在哪一步？',
    ],
  };

  const teaching = buildTeaching(content, chain, example, checks);
  const manifest: Record<string, unknown> = {
    schema_version: '1.1',
    page_id: options.pageId,
    title: stripInline(content.title),
    subtitle: stripInline(content.lede ?? ''),
    knowledge_point_ids:
      options.knowledgePointIds && options.knowledgePointIds.length > 0
        ? options.knowledgePointIds
        : [`kp_${options.pageId}`],
    importance: options.importance ?? 'core',
    estimated_minutes: minutes,
    layout: `page-kit-${theme}`,
    interactions,
    source_refs: manifestRefs,
    design_system: '2.0',
    renderer: { kit: 'page-kit', version: PAGE_KIT_VERSION, theme },
    teaching,
    assistant,
    a11y: { reduced_motion: true },
  };

  return { html, css: '', js: '', manifest, teaching, issues };
}
