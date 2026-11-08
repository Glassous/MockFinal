/**
 * 主题 A · 讲义型：单栏正文 + 右侧页边注，规则线代替卡片。
 * 目标：像一本排版克制的课程讲义，正文是绝对主角，图示是页边图版。
 */

export const EDITORIAL_CSS = `
.pg-page[data-pg-theme="editorial"] {
  --pg-body-size: 17px;
  --pg-body-lh: 1.85;
  --pg-content: 44rem;
  --pg-rail-w: 19rem;
  grid-template-columns:
    minmax(28px, 1fr)
    minmax(0, 44rem)
    minmax(17rem, 20rem)
    minmax(28px, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  grid-template-areas:
    ". head head ."
    ". outline outline ."
    ". main rail ."
    ". foot foot .";
  column-gap: clamp(24px, 3vw, 56px);
  row-gap: var(--pg-gap);
  padding-top: clamp(30px, 4.4vh, 56px);
}

.pg-page[data-pg-theme="editorial"] .pg-head { max-width: none; }
.pg-page[data-pg-theme="editorial"] .pg-outline { display: none; }
.pg-page[data-pg-theme="editorial"] .pg-flow { max-width: 44rem; gap: clamp(18px, 2.4vh, 28px); }
.pg-page[data-pg-theme="editorial"] .pg-rail { position: sticky; top: 26px; align-self: start; }
.pg-page[data-pg-theme="editorial"] .pg-title { font-weight: 700; }

.pg-page[data-pg-theme="editorial"] .pg-lede { max-width: 48ch; }

/* 讲义里少用卡片：提示块改成上下规则线 */
.pg-page[data-pg-theme="editorial"] .pg-callout-key,
.pg-page[data-pg-theme="editorial"] .pg-callout-definition,
.pg-page[data-pg-theme="editorial"] .pg-callout-theorem {
  padding: 14px 0;
  border: 0;
  border-top: 1px solid var(--mp-border-strong);
  border-bottom: 1px solid var(--mp-border);
  border-radius: 0;
  background: transparent;
}
.pg-page[data-pg-theme="editorial"] .pg-callout-pitfall {
  padding: 8px 0 8px 14px;
  border-left: 2px solid var(--mp-ink);
}
.pg-page[data-pg-theme="editorial"] .pg-callout h2 { font-size: 17.5px; }

.pg-page[data-pg-theme="editorial"] .pg-example {
  padding: 16px 0;
  border: 0;
  border-top: 1px solid var(--mp-border-strong);
  border-bottom: 1px solid var(--mp-border);
  border-radius: 0;
  background: transparent;
}
.pg-page[data-pg-theme="editorial"] .pg-answer {
  padding: 8px 0 8px 12px;
  border: 0;
  border-left: 2px solid var(--mp-ink);
  border-radius: 0;
  background: transparent;
}

.pg-page[data-pg-theme="editorial"] .pg-check {
  padding: 16px 0 0;
  border: 0;
  border-top: 1px solid var(--mp-border-strong);
  border-radius: 0;
  background: transparent;
}
.pg-page[data-pg-theme="editorial"] .pg-option {
  border-radius: 8px;
  background: transparent;
}
.pg-page[data-pg-theme="editorial"] .pg-explanation {
  border-radius: 0;
  border-left: 2px solid var(--mp-ink);
  background: transparent;
}

.pg-page[data-pg-theme="editorial"] .pg-figure {
  padding: 10px;
  border: 1px solid var(--mp-border);
  border-radius: 4px;
  background: var(--mp-raised);
}
.pg-page[data-pg-theme="editorial"] .pg-figure-svg { max-height: 230px; }
.pg-page[data-pg-theme="editorial"] .pg-quickfacts {
  padding: 8px 0 0;
  border: 0;
  border-top: 1px solid var(--mp-border);
  border-radius: 0;
  background: transparent;
}
.pg-page[data-pg-theme="editorial"] .pg-quickfacts ul { font-size: 12.5px; }

.pg-page[data-pg-theme="editorial"] .pg-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pg-page[data-pg-theme="editorial"] .pg-summary-card { border: 0; border-top: 1px solid var(--mp-border-strong); border-radius: 0; padding: 10px 0; }

.pg-page[data-pg-theme="editorial"] .pg-foot { font-size: 12px; }

@media (max-width: 1120px) {
  .pg-page[data-pg-theme="editorial"] {
    grid-template-columns:
      minmax(20px, 1fr)
      minmax(0, 40rem)
      minmax(15rem, 18rem)
      minmax(20px, 1fr);
    column-gap: clamp(18px, 2.4vw, 36px);
    --pg-body-size: 16.5px;
  }
  .pg-page[data-pg-theme="editorial"] .pg-figure-svg { max-height: 200px; }
}
`;
