// 脚手架说明：只调用 window.MockFinal；禁止网络、存储、eval、父窗口访问与动态注入。
// 结构：IIFE 包裹（不泄漏全局）→ 单一 step 状态 → 幂等 render → 事件绑定 → ready 一次。
// 提交前删除本注释与 TODO，按 brief 实现真实状态机。
(function () {
  var root = document.querySelector('.mp-page');
  if (!root) { return; }

  // 状态承载元素：状态文案 / 主按钮 / 重置按钮（与 manifest.interactions[].smoke 对应）。
  var statusEl = root.querySelector('[data-mp-role="status"]');
  var stepBtn = root.querySelector('[data-mp-action="step"]');
  var resetBtn = root.querySelector('[data-mp-action="reset"]');

  // 每一步的可见文案；真实页面请由 brief 的 key_points 派生，不要写死无来源结论。
  var MESSAGES = ['初始状态：区间与目标已就绪。', '第一步：比较后排除一半。', '完成：命中或区间为空。'];
  var step = 0;

  function render() {
    // 1) 根状态：idle → stepped → done；smoke.expect 只依赖这些值。
    root.dataset.mpState = step === 0 ? 'idle' : (step >= MESSAGES.length - 1 ? 'done' : 'stepped');
    root.dataset.mpStep = String(step);
    // 2) 可见文案立即更新（不要等 transitionend，reduced-motion 下没有过渡）。
    statusEl.textContent = MESSAGES[step];
    // 3) 需要随状态变化的子元素在这里统一切换 data-mp-state，保持 render 幂等。
  }

  function emit() {
    window.MockFinal.emit('interaction', { id: 'template-step', step: step, state: root.getAttribute('data-mp-state') });
  }

  if (stepBtn) {
    stepBtn.addEventListener('click', function () {
      if (step < MESSAGES.length - 1) {
        step += 1;
        render();
        emit();
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      step = 0;
      render();
      emit();
    });
  }

  // 宿主消息：theme 到达后重渲染（颜色来自 CSS 变量，这里只刷新依赖状态的文本）。
  if (typeof window.MockFinal.onHostMessage === 'function') {
    window.MockFinal.onHostMessage(function (msg) {
      if (msg && msg.type === 'theme') { render(); }
    });
  }

  render();
  // 每页必须且只能调用一次；放在首屏渲染完成后。
  window.MockFinal.ready({ title: '页面主标题' });
})();
