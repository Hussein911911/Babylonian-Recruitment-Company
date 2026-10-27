/* Keep the actual navigation buttons above the mobile software keyboard.
 * They are moved (not copied) outside animated pages, preserving handlers,
 * disabled states and the returning-card back-button restriction. */
(function (root) {
  'use strict';
  var doc = root.document, viewport = root.visualViewport;
  var baseline = root.innerHeight, row = null, placeholder = null, page = null;
  var dock = null, frame = null;
  function restore() {
    if (row && placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(row, placeholder);
      placeholder.remove();
    }
    row = placeholder = page = null;
    if (dock) { dock.remove(); dock = null; }
    doc.body.classList.remove('keyboard-navigation-open');
    doc.documentElement.style.removeProperty('--keyboard-nav-height');
  }
  function editable(el) {
    return el && !el.disabled && !el.readOnly &&
      (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && /^(text|tel|search|number|email|password|url)$/.test(el.type)));
  }
  function update() {
    frame = null;
    var height = viewport ? viewport.height : root.innerHeight;
    var offset = viewport ? viewport.offsetTop : 0;
    var active = doc.querySelector('.page.active');
    var field = doc.activeElement;
    if (page && page !== active) restore();
    var narrow = root.innerWidth <= 760;
    var typing = editable(field) && active && active.contains(field);
    if (!typing && !row) baseline = Math.max(baseline, height, root.innerHeight);
    var keyboard = baseline - height > 140;
    // A zoomed visual viewport is not evidence that a keyboard opened.
    if (!narrow || (viewport && viewport.scale > 1.05) || !keyboard || (!typing && !row)) {
      restore(); return;
    }
    if (!row) {
      var candidate = active.querySelector('.btn-row');
      if (!candidate) return;
      page = active; row = candidate;
      placeholder = doc.createElement('div');
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.height = (row.getBoundingClientRect().height + 24) + 'px';
      row.parentNode.insertBefore(placeholder, row);
      dock = doc.createElement('div');
      dock.id = 'keyboard-navigation';
      dock.setAttribute('role', 'group');
      dock.setAttribute('aria-label', 'التنقل بين خطوات التقديم');
      dock.appendChild(row);
      doc.body.appendChild(dock);
      doc.body.classList.add('keyboard-navigation-open');
    }
    dock.style.bottom = Math.max(0, root.innerHeight - height - offset) + 'px';
    var dockHeight = dock.getBoundingClientRect().height;
    doc.documentElement.style.setProperty('--keyboard-nav-height', dockHeight + 'px');
    if (typing) {
      /* نُبقي الحقل النشط فوق لوحة الأزرار: نوسطه في المساحة المرئية.
         كان scrollBy وحده لا يكفي لأن scroll-behavior:smooth على <html>
         يجعل التمرير مُهيَّأً فيُقطع مع كل حدث visualViewport. */
      var rect = field.getBoundingClientRect();
      var visibleBottom = offset + height - dockHeight - 20;
      var visibleTop = offset + 12;
      var target = null;
      if (rect.bottom > visibleBottom) target = root.scrollY + (rect.bottom - visibleBottom) + Math.max(0, (visibleBottom - rect.height) / 2 - rect.top / 2);
      else if (rect.top < visibleTop) target = root.scrollY - (visibleTop - rect.top);
      if (target !== null) {
        var html = doc.documentElement;
        var previous = html.style.scrollBehavior;
        html.style.scrollBehavior = 'auto';
        root.scrollTo(0, Math.max(0, target));
        html.style.scrollBehavior = previous;
      }
    }
  }
  function schedule() {
    if (frame === null) frame = root.requestAnimationFrame(update);
  }
  function reset() {
    if (frame !== null) root.cancelAnimationFrame(frame);
    frame = null; restore();
  }
  root.HRCApplyNavigation = { reset: reset };
  function init() {
    doc.addEventListener('focusin', schedule);
    doc.addEventListener('focusout', schedule);
    root.addEventListener('resize', schedule);
    root.addEventListener('pageshow', schedule);
    root.addEventListener('orientationchange', function () {
      reset(); baseline = root.innerHeight; schedule();
    });
    if (viewport) {
      viewport.addEventListener('resize', schedule);
      viewport.addEventListener('scroll', schedule);
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
