(function () {
  var root = document.querySelector('.mp-page');
  if (!root) { return; }
  var steps = Array.prototype.slice.call(root.querySelectorAll('[data-mp-step]'));
  var statusEl = root.querySelector('[data-mp-role="status"]');
  var explanation = root.querySelector('[data-mp-role="explanation"]');
  var current = 0;

  function render() {
    root.dataset.mpState = current === 0 ? 'idle' : (current >= steps.length - 1 ? 'done' : 'stepped');
    root.dataset.mpStep = String(current);
    steps.forEach(function (step, index) {
      step.setAttribute('aria-current', index === current ? 'step' : 'false');
      step.dataset.mpState = index < current ? 'done' : (index === current ? 'active' : 'pending');
    });
    if (statusEl) {
      statusEl.textContent = '当前第 ' + (current + 1) + ' / ' + steps.length + ' 步：替换为真实状态说明。';
    }
    window.MockFinal.emit('progress', { step: current + 1, total: steps.length, label: '讲解步骤' });
    if (current >= steps.length - 1) {
      window.MockFinal.emit('complete', { reason: 'steps_done' });
    }
  }

  root.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) { return; }
    var step = target.closest('[data-mp-step]');
    if (step) {
      current = Math.max(current, Number(step.getAttribute('data-mp-step')) || 0);
      render();
      return;
    }
    var action = target.closest('[data-mp-action]');
    if (!action) { return; }
    var name = action.getAttribute('data-mp-action');
    if (name === 'step') {
      current = Math.min(steps.length - 1, current + 1);
      render();
    } else if (name === 'reset') {
      current = 0;
      if (explanation) { explanation.hidden = true; }
      root.querySelectorAll('[data-mp-answer]').forEach(function (option) {
        delete option.dataset.mpState;
      });
      render();
    } else if (name === 'answer') {
      if (explanation) { explanation.hidden = false; }
      window.MockFinal.emit('interaction', { id: 'template-answer', answer: Number(action.getAttribute('data-mp-answer')) });
    }
  });

  render();
  window.MockFinal.ready({ title: '本页标题' });
})();
