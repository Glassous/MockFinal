/**
 * 主题 C · 题解型：真题 hero + 思路 + 步骤脊柱 + 答案，左侧步骤小地图。
 * 目标：最贴近期末刷题的阅读方式，先看题，再看解法，最后自测。
 */

export const PROBLEM_CSS = `
.pg-page[data-pg-theme="problem"] {
  --pg-body-size: 16.5px;
  --pg-body-lh: 1.8;
  --pg-content: 45rem;
  --pg-rail-w: 19rem;
  grid-template-columns: 9rem minmax(0, 1fr) 19rem;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  grid-template-areas:
    "head head head"
    "outline main rail"
    "outline main rail"
    "foot foot foot";
  column-gap: clamp(16px, 2vw, 30px);
  row-gap: var(--pg-gap);
  padding-top: 24px;
}

html[data-mp-scroll="fit"] .pg-page[data-pg-theme="problem"] {
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "head head head"
    "outline main rail"
    "foot foot foot";
}

.pg-page[data-pg-theme="problem"] .pg-head {
  gap: 8px;
  max-width: none;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--mp-border);
}
.pg-page[data-pg-theme="problem"] .pg-title { font-size: clamp(28px, 2.8vw, 38px); }
.pg-page[data-pg-theme="problem"] .pg-lede { font-size: 15px; max-width: 64ch; }

.pg-page[data-pg-theme="problem"] .pg-outline {
  position: sticky;
  top: 22px;
  align-self: start;
  padding: 12px 0 0 12px;
  border-left: 2px solid var(--mp-ink);
}
.pg-page[data-pg-theme="problem"] .pg-outline-link { font-size: 12px; color: var(--mp-muted); }
.pg-page[data-pg-theme="problem"] .pg-outline-link:hover { color: var(--mp-ink); }

.pg-page[data-pg-theme="problem"] .pg-flow { gap: 18px; max-width: 45rem; }
.pg-page[data-pg-theme="problem"] .pg-rail { position: sticky; top: 22px; align-self: start; gap: 12px; }

/* 真题 hero：粗上边、深色题面 */
.pg-page[data-pg-theme="problem"] .pg-example {
  padding: 18px 20px 16px;
  border: 1px solid var(--mp-border-strong);
  border-top: 3px solid var(--mp-ink);
  border-radius: 0 0 14px 14px;
  background: var(--mp-panel);
}
.pg-page[data-pg-theme="problem"] .pg-example-problem {
  font-size: calc(var(--pg-body-size) + 1px);
  line-height: 1.8;
  font-weight: 600;
}
.pg-page[data-pg-theme="problem"] .pg-step-index {
  border-color: var(--mp-ink);
  color: var(--mp-ink);
  font-weight: 600;
}
.pg-page[data-pg-theme="problem"] .pg-answer {
  border: 0;
  border-top: 2px solid var(--mp-ink);
  border-radius: 0;
  background: transparent;
  padding: 10px 0 0;
}
.pg-page[data-pg-theme="problem"] .pg-pitfall {
  border-left: 2px dashed var(--mp-border-strong);
}

.pg-page[data-pg-theme="problem"] .pg-callout-key,
.pg-page[data-pg-theme="problem"] .pg-callout-definition,
.pg-page[data-pg-theme="problem"] .pg-callout-theorem {
  padding: 10px 0 10px 14px;
  border: 0;
  border-left: 2px solid var(--mp-ink);
  border-radius: 0;
  background: transparent;
}
.pg-page[data-pg-theme="problem"] .pg-callout h2 { font-size: 16.5px; }
.pg-page[data-pg-theme="problem"] .pg-callout p { font-size: 15px; line-height: 1.78; }

.pg-page[data-pg-theme="problem"] .pg-check {
  padding: 16px 18px;
  border: 1px solid var(--mp-border-strong);
  border-radius: 12px;
  background: var(--mp-raised);
}
.pg-page[data-pg-theme="problem"] .pg-figure { padding: 10px; border-radius: 12px; }
.pg-page[data-pg-theme="problem"] .pg-figure-svg { max-height: 220px; }
.pg-page[data-pg-theme="problem"] .pg-quickfacts { padding: 10px 12px; border-radius: 12px; }
.pg-page[data-pg-theme="problem"] .pg-quickfacts ul { font-size: 12.5px; }

@media (max-width: 1180px) {
  .pg-page[data-pg-theme="problem"] {
    grid-template-columns: 8rem minmax(0, 1fr) 16rem;
    --pg-body-size: 16px;
  }
  .pg-page[data-pg-theme="problem"] .pg-figure-svg { max-height: 190px; }
}
@media (max-width: 1040px) {
  .pg-page[data-pg-theme="problem"] {
    grid-template-columns: minmax(0, 1fr) 16rem;
    grid-template-areas:
      "head head"
      "main rail"
      "main rail"
      "foot foot";
  }
  .pg-page[data-pg-theme="problem"] .pg-outline { display: none; }
}
`;
