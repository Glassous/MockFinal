/**
 * page-kit 2.0 · 通用交互运行时
 *
 * 负责图示步骤、选项检查、路线跳转、上一页/下一页、重置与 MockFinal.ready。
 * 页面内容模型不允许每页自带脚本；所有 2.0 页面共用这一份逻辑。
 */

export const PAGE_KIT_JS = `
(function () {
  'use strict';
  var root = document.querySelector('.pg-page');
  if (!root) return;
  var api = window.MockFinal;
  var reduceMotion = document.documentElement.getAttribute('data-mp-reduced-motion') === 'true';

  function resolveTarget(id) {
    if (!id) return null;
    return document.getElementById(id) || root.querySelector('[data-mp-block="' + id + '"]');
  }

  var figure = root.querySelector('[data-pg-figure]');
  var figureIndex = 0;
  var figureTotal = figure ? Number(figure.getAttribute('data-pg-states') || '1') : 0;
  var figureStateLabel = figure ? figure.querySelector('[data-pg-figure-state-label]') : null;

  function emit(type, payload) {
    if (!api || typeof api.emit !== 'function') return;
    try { api.emit(type, payload); } catch (err) { /* runtime 不可用时静默 */ }
  }

  function setActiveFigure() {
    if (!figure) return;
    figure.setAttribute('data-pg-figure-state', String(figureIndex));
    var groups = figure.querySelectorAll('[data-pg-state-group]');
    for (var i = 0; i < groups.length; i += 1) {
      groups[i].setAttribute('data-pg-active', String(i === figureIndex));
    }
    var notes = figure.querySelectorAll('[data-pg-note]');
    for (var j = 0; j < notes.length; j += 1) {
      notes[j].hidden = Number(notes[j].getAttribute('data-pg-note')) !== figureIndex;
    }
    if (figureStateLabel) {
      figureStateLabel.textContent = String(figureIndex + 1) + '/' + String(figureTotal);
    }
    emit('progress', { step: figureIndex + 1, total: figureTotal });
  }

  function resetChecks() {
    var checks = root.querySelectorAll('[data-pg-check]');
    for (var i = 0; i < checks.length; i += 1) {
      checks[i].removeAttribute('data-pg-check-state');
      var options = checks[i].querySelectorAll('[data-pg-option]');
      for (var j = 0; j < options.length; j += 1) {
        options[j].removeAttribute('data-pg-state');
        options[j].removeAttribute('aria-pressed');
      }
      var explanation = checks[i].querySelector('[data-pg-explanation]');
      if (explanation) explanation.hidden = true;
    }
  }

  function resetPage() {
    figureIndex = 0;
    setActiveFigure();
    resetChecks();
  }

  function findAction(target) {
    var element = target;
    while (element && element !== root) {
      if (element.getAttribute && element.getAttribute('data-pg-action')) return element;
      element = element.parentElement;
    }
    return null;
  }

  root.addEventListener('click', function (event) {
    var actionTarget = findAction(event.target);
    if (!actionTarget) return;
    var action = actionTarget.getAttribute('data-pg-action');
    if (action === 'figure-next') {
      figureIndex = Math.min(figureIndex + 1, Math.max(0, figureTotal - 1));
      setActiveFigure();
    } else if (action === 'figure-prev') {
      figureIndex = Math.max(figureIndex - 1, 0);
      setActiveFigure();
    } else if (action === 'figure-reset' || action === 'reset') {
      resetPage();
    } else if (action === 'next') {
      if (api && typeof api.next === 'function') api.next();
    } else if (action === 'prev') {
      if (api && typeof api.prev === 'function') api.prev();
    } else if (action === 'goto') {
      var blockId = actionTarget.getAttribute('data-pg-goto');
      var block = resolveTarget(blockId);
      if (block && typeof block.scrollIntoView === 'function') {
        block.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        block.setAttribute('data-mp-focus', 'true');
      }
    }
  });

  var optionButtons = root.querySelectorAll('[data-pg-option]');
  for (var oi = 0; oi < optionButtons.length; oi += 1) {
    optionButtons[oi].addEventListener('click', function (event) {
      var button = event.currentTarget;
      var check = button.closest('[data-pg-check]');
      if (!check || check.getAttribute('data-pg-check-state') === 'answered') return;
      var correct = button.getAttribute('data-pg-correct') === 'true';
      button.setAttribute('data-pg-state', correct ? 'correct' : 'wrong');
      button.setAttribute('aria-pressed', 'true');
      if (!correct) {
        var all = check.querySelectorAll('[data-pg-option]');
        for (var i = 0; i < all.length; i += 1) {
          if (all[i].getAttribute('data-pg-correct') === 'true') {
            all[i].setAttribute('data-pg-state', 'correct');
          }
        }
      }
      var result = check.querySelector('[data-pg-result]');
      if (result) {
        if (correct) {
          result.textContent = '答对了。';
        } else {
          var key = check.querySelector('[data-pg-option][data-pg-correct="true"] .pg-option-key');
          result.textContent = key ? '答错了，正确答案是 ' + key.textContent + '。' : '答错了。';
        }
        result.hidden = false;
      }
      var explanation = check.querySelector('[data-pg-explanation]');
      if (explanation) explanation.hidden = false;
      check.setAttribute('data-pg-check-state', 'answered');
      emit('interaction', { type: 'check', correct: correct });
    });
  }

  if (api && typeof api.onHostMessage === 'function') {
    api.onHostMessage(function (message) {
      if (!message || message.type !== 'focus_block' || !message.payload) return;
      var blockId = message.payload.block_id;
      var block = blockId ? root.querySelector('[data-mp-block="' + blockId + '"]') : null;
      if (block && typeof block.scrollIntoView === 'function') {
        block.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
    });
  }

  function markFormulaScrollers() {
    var wraps = root.querySelectorAll('.pg-formula-wrap');
    for (var i = 0; i < wraps.length; i += 1) {
      var formula = wraps[i].querySelector('.pg-formula');
      if (formula && formula.scrollWidth > formula.clientWidth + 1) {
        wraps[i].setAttribute('data-pg-scrollable', 'true');
      } else {
        wraps[i].removeAttribute('data-pg-scrollable');
      }
    }
  }
  var formulaTimer = 0;
  window.addEventListener('resize', function () {
    if (formulaTimer) window.clearTimeout(formulaTimer);
    formulaTimer = window.setTimeout(markFormulaScrollers, 150);
  });

  var outlineLinks = root.querySelectorAll('.pg-outline-link[data-pg-goto]');
  var outlineTick = 0;

  function updateOutlineCurrent() {
    if (!outlineLinks.length) return;
    var spyOffset = window.innerWidth <= 960 ? 150 : 32;
    var current = null;
    for (var i = 0; i < outlineLinks.length; i += 1) {
      var id = outlineLinks[i].getAttribute('data-pg-goto');
      var block = resolveTarget(id);
      if (!block) continue;
      if (block.getBoundingClientRect().top <= spyOffset) current = outlineLinks[i];
    }
    for (var j = 0; j < outlineLinks.length; j += 1) {
      if (outlineLinks[j] === current) {
        outlineLinks[j].setAttribute('data-pg-current', 'true');
        outlineLinks[j].setAttribute('aria-current', 'location');
      } else {
        outlineLinks[j].removeAttribute('data-pg-current');
        outlineLinks[j].removeAttribute('aria-current');
      }
    }
  }

  function scheduleOutlineUpdate() {
    if (outlineTick) return;
    outlineTick = window.requestAnimationFrame(function () {
      outlineTick = 0;
      updateOutlineCurrent();
    });
  }
  window.addEventListener('scroll', scheduleOutlineUpdate, { passive: true });
  window.addEventListener('resize', scheduleOutlineUpdate);

  setActiveFigure();
  markFormulaScrollers();
  updateOutlineCurrent();
  window.setTimeout(markFormulaScrollers, 120);
  if (api && typeof api.ready === 'function') {
    api.ready({ title: root.getAttribute('data-pg-title') || document.title || '' });
  }
})();
`;
