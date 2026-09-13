/* ===========================================================================
 *  BRC — أدوات واجهة مشتركة (UI Kit)
 *  عناصر مساعدة: تنبيهات، نوافذ، شارات، عدّادات زمنية، تنزيل ملفات.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.BRC_CONFIG;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function ic(name, cls) {
    return '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '" xlink:href="#i-' + name + '"/></svg>';
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function money(n) { return root.BRCStore.money(n); }
  function fmtDate(d) { return root.BRCStore.fmtDate(d); }
  function fmtDateTime(d) { return root.BRCStore.fmtDateTime(d); }

  /* شارة حالة من خرائط الإعدادات */
  function badge(map, key) {
    var item = map[key] || { ar: key, cls: 'muted' };
    return '<span class="badge ' + item.cls + '">' + esc(item.ar) + '</span>';
  }
  function jobBadge(k) { return badge(CFG.jobStatus, k); }
  function slotBadge(k) { return badge(CFG.slotStatus, k); }
  function formBadge(k) { return badge(CFG.formStatus, k); }

  /* ---------------- التنبيهات ---------------- */
  function toast(type, title, msg, ms) {
    var host = document.getElementById('toast-root');
    if (!host) return;
    var icons = { ok: 'check', warn: 'alert', err: 'x-circle', info: 'sparkle' };
    var node = el('<div class="toast ' + type + '">' + ic(icons[type] || 'sparkle') +
      '<div><b>' + esc(title) + '</b>' + (msg ? '<span>' + esc(msg) + '</span>' : '') + '</div></div>');
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0'; node.style.transform = 'translateX(-14px)';
      setTimeout(function () { node.remove(); }, 320);
    }, ms || 4200);
  }

  /* ---------------- النوافذ المنبثقة ---------------- */
  function modal(opts) {
    opts = opts || {};
    var host = document.getElementById('modal-root');
    if (!host) return null;
    var backdrop = el('<div class="modal-backdrop"></div>');
    var box = el('<div class="modal' + (opts.wide ? ' modal-wide' : '') + '"></div>');
    box.innerHTML =
      '<div class="modal-head">' +
        '<div><h3>' + esc(opts.title || '') + '</h3>' +
        (opts.subtitle ? '<div class="tiny muted">' + esc(opts.subtitle) + '</div>' : '') + '</div>' +
        '<button class="icon-btn" data-close aria-label="إغلاق">' + ic('x') + '</button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '');
    backdrop.appendChild(box);
    host.appendChild(backdrop);

    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    box.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
    if (opts.onMount) opts.onMount(box, close);
    var first = box.querySelector('input, select, textarea, button:not([data-close])');
    if (first) setTimeout(function () { first.focus(); }, 60);
    return { root: box, close: close };
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      var m = modal({
        title: opts.title || 'تأكيد العملية',
        body: '<p class="mb-0">' + esc(opts.message || '') + '</p>' +
          (opts.note ? '<p class="tiny muted mt-2 mb-0">' + esc(opts.note) + '</p>' : ''),
        footer: '<button class="btn btn-outline" data-cancel>إلغاء</button>' +
          '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-lapis') + '" data-ok>' + esc(opts.confirmText || 'تأكيد') + '</button>',
        onMount: function (boxRoot, close) {
          boxRoot.querySelector('[data-cancel]').addEventListener('click', function () { close(); resolve(false); });
          boxRoot.querySelector('[data-ok]').addEventListener('click', function () { close(); resolve(true); });
        },
        onClose: function () { resolve(false); }
      });
      if (!m) resolve(window.confirm(opts.message || ''));
    });
  }

  /* ---------------- عدّاد زمني للحجز 24 ساعة ---------------- */
  function holdHtml(expiryISO, opts) {
    opts = opts || {};
    if (!expiryISO) return '<span class="muted tiny">—</span>';
    var ms = new Date(expiryISO).getTime() - Date.now();
    var urgent = ms < 4 * 3600 * 1000;
    var label = ms <= 0 ? 'انتهت المهلة' : humanDuration(ms);
    return '<span class="hold-timer' + (urgent ? ' urgent' : '') + '" data-expiry="' + esc(expiryISO) + '">' +
      ic('hourglass') + '<span data-countdown>' + esc(label) + '</span>' +
      (opts.withDate !== false ? ' <span class="tiny muted" dir="ltr">(' + fmtDateTime(expiryISO) + ')</span>' : '') +
      '</span>';
  }

  function humanDuration(ms) {
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    if (h <= 0) return m + ' دقيقة';
    return h + ' ساعة' + (m ? ' و' + m + ' دقيقة' : '');
  }

  /* تحديث كل العدّادات في الصفحة كل ثانية */
  var cdTimer = null;
  function startCountdowns() {
    if (cdTimer) return;
    cdTimer = setInterval(function () {
      document.querySelectorAll('[data-expiry]').forEach(function (node) {
        var ms = new Date(node.getAttribute('data-expiry')).getTime() - Date.now();
        var label = node.querySelector('[data-countdown]');
        if (!label) return;
        if (ms <= 0) {
          if (label.textContent !== 'انتهت المهلة') {
            label.textContent = 'انتهت المهلة';
            node.classList.add('urgent');
            // إعادة رسم عامة لتحديث الجداول بعد الإفراج
            if (root.BRCRefresh) root.BRCRefresh();
          }
          return;
        }
        label.textContent = humanDuration(ms);
        node.classList.toggle('urgent', ms < 4 * 3600 * 1000);
      });
    }, 1000);
  }

  /* ---------------- أدوات مساعدة ---------------- */
  function debounce(fn, ms) {
    var t; return function () {
      var a = arguments, self = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 220);
    };
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function fillSelect(select, items, allLabel) {
    if (!select) return;
    var value = select.value;
    select.innerHTML = '<option value="all">' + esc(allLabel || 'الكل') + '</option>' +
      items.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
    if (value) select.value = value;
  }

  function relativeDays(iso) {
    var d = root.BRCStore.diffDays(iso, new Date());
    if (d < 0) return 'منتهية';
    if (d === 0) return 'تنتهي اليوم';
    return d + ' يوم';
  }

  root.BRCUI = {
    esc: esc, ic: ic, el: el, money: money, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    badge: badge, jobBadge: jobBadge, slotBadge: slotBadge, formBadge: formBadge,
    toast: toast, modal: modal, confirm: confirm, holdHtml: holdHtml, humanDuration: humanDuration,
    startCountdowns: startCountdowns, debounce: debounce, download: download,
    fillSelect: fillSelect, relativeDays: relativeDays
  };
  if (typeof module === 'object' && module.exports) module.exports = root.BRCUI;
})(typeof window !== 'undefined' ? window : globalThis);
