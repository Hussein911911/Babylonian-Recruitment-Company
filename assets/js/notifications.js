/* Staff-only activity feed. Existing authorized Store/realtime data is the source
 * of truth; no new network access, mutation, secret fields or cached payloads.
 * Read IDs are device/project/account-scoped, not a shared company decision. */
(function (root) {
  'use strict';
  var LIMIT = 100;
  // Display-only triage; never a hiring decision or mutation of business data.
  var SECTIONS = {
    alert: { label: 'حرج', hint: 'تنبيهات عالية الأولوية للمراجعة', rank: 0 },
    decision: { label: 'مهم', hint: 'قرارات وأحداث مهمة للمراجعة', rank: 1 },
    booking: { label: 'الحجوزات', hint: 'متابعة الحجوزات المسجلة', rank: 2 },
    update: { label: 'عادي', hint: 'تحديثات العمل اليومية', rank: 3 }
  };
  function sectionFor(item) {
    if (item.kind === 'alert') return 'alert';
    if (item.kind === 'decision') return 'decision';
    if (item.kind === 'booking') return 'booking';
    // A data-removal/recovery event must not be painted like routine activity.
    if ((item.jobCode && /حذف/.test(item.title || '')) || /حذف وظيفة|حذف بيانات/.test(item.title || '')) return 'alert';
    if (/استرجاع|تعطيل|حذف/.test(item.title || '')) return 'decision';
    return 'update';
  }
  function build(db, user) {
    if (!user || ['admin', 'staff'].indexOf(user.role) < 0) return [];
    var items = [], covered = [], jobs = Object.create(null), seen = Object.create(null);
    (db.jobs || []).forEach(function (j) { jobs[j.code] = j; });
    function add(item) {
      item.time = Date.parse(item.at);
      if (!isFinite(item.time) || seen[item.id]) return;
      item.section = sectionFor(item);
      seen[item.id] = true; items.push(item);
    }
    (db.attempts || []).forEach(function (t) {
      if (!t.jobCode || t.slotStatus === 'empty') return;
      var j = jobs[t.jobCode] || {}, key = String(t.serial + ':' + t.no);
      var common = { jobCode: t.jobCode, serial: t.serial, jobTitle: j.title || t.jobTitle || '', view: 'holds' };
      function event(id, kind, title, at, body, reason) {
        add(Object.assign({}, common, { id: id + ':' + key + ':' + at, kind: kind, title: title, at: at, body: body, reason: reason || '' }));
        if (at) covered.push({ at: Date.parse(at), serial: t.serial, job: t.jobCode, kind: kind });
      }
      if (t.selectedAt) event('reservation', 'booking', 'حجز جديد على وظيفة', t.selectedAt, 'البطاقة ' + t.serial + ' · الفرصة ' + t.no);
      if (t.employerDecision && t.decisionAt) {
        var hire = t.employerDecision === 'hire';
        event('employer-' + t.employerDecision, 'decision', hire ? 'صاحب العمل: تم التوظيف' : 'صاحب العمل: لم يتم التوظيف', t.decisionAt,
          hire ? 'طلب صاحب العمل بانتظار تثبيت الشركة؛ ليس قراراً نهائياً بعد.' : 'بانتظار قرار الشركة؛ لا تُعاد الوظيفة متاحة تلقائياً.',
          hire ? '' : (t.reason || 'لم يُسجّل سبب في البيانات المتاحة.'));
      }
      if (t.closedAt && ['succeeded', 'rejected'].indexOf(t.slotStatus) >= 0) {
        event('outcome-' + t.slotStatus, 'update', t.slotStatus === 'succeeded' ? 'الشركة: تثبيت التوظيف' : 'الشركة: إغلاق الفرصة دون توظيف', t.closedAt, t.note || 'تم تسجيل قرار الشركة.');
      }
    });
    (db.jobs || []).forEach(function (j) {
      var at = j.updatedAt || j.createdAt;
      var already = covered.some(function (c) { return c.job === j.code && Math.abs(c.at - Date.parse(at)) < 60000; }) ||
        (db.audit || []).some(function (a) { return a.entity === 'job' && a.entityId === j.code && Math.abs(Date.parse(a.ts) - Date.parse(at)) < 60000; });
      if (!at || already) return;
      var critical = j.critical || (db.attempts || []).some(function (t) { return t.jobCode === j.code && t.slotStatus === 'critical'; });
      var labels = { available: 'متاحة', reserved: 'محجوزة', hiring: 'جاري التوظيف', closed: 'مغلقة' };
      add({ id: 'job:' + j.code + ':' + at + ':' + j.status, kind: critical ? 'alert' : 'update', title: 'آخر حالة للوظيفة: ' + (critical ? 'حرجة — بانتظار الشركة' : (labels[j.status] || j.status)),
        at: at, jobCode: j.code, jobTitle: j.title || '', serial: '', view: critical ? 'holds' : 'jobs', reason: '', body: 'آخر حالة مسجلة في بيانات الشركة.' });
    });
    (db.audit || []).forEach(function (a) {
      var entity = a.entity, action = String(a.action || ''), at = Date.parse(a.ts), body = a.details || '';
      if (action === 'حفظ وظيفة ورمز صاحب العمل') { action = 'تحديث بيانات وظيفة'; body = 'تم حفظ بيانات الوظيفة لدى الشركة.'; }
      var operational = entity === 'job' || entity === 'applicant';
      if (user.role !== 'admin' && entity === 'applicant' && a.user !== user.username && ['system', 'employer'].indexOf(a.role) < 0) return;
      if (!operational && !(user.role === 'admin' && ['settings', 'setting', 'backup', 'system', 'user'].indexOf(entity) >= 0)) return;
      // Authentication/secret administration is not a notification payload.
      if (/رمز|كلمة مرور|دخول|خروج|تحقق|QR/i.test(action)) return;
      var duplicate = covered.some(function (c) {
        return Math.abs(c.at - at) < 60000 && (a.entityId === c.serial || a.entityId === c.job) &&
          ((c.kind === 'decision' && /صاحب العمل/.test(action)) || (c.kind === 'booking' && /حجز مؤقت|تقديم ذاتي/.test(action)) ||
           (c.kind === 'update' && /إتمام توظيف|رفض مرشح/.test(action)));
      });
      if (duplicate) return;
      var jobCode = entity === 'job' ? a.entityId : '', j = jobs[jobCode] || {};
      add({ id: 'audit:' + a.id, kind: /حرجة|انتهاء/.test(action) ? 'alert' : 'update', title: action,
        body: body, reason: '', at: a.ts, jobCode: jobCode, jobTitle: j.title || '',
        serial: entity === 'applicant' ? a.entityId : '',
        view: entity === 'job' ? 'jobs' : entity === 'applicant' ? (user.role === 'admin' ? 'applicants' : 'overview') : 'settings' });
    });
    return items.sort(function (a, b) { return b.time - a.time || a.id.localeCompare(b.id); }).slice(0, LIMIT);
  }
  root.HRCNotifications = { build: build, sections: SECTIONS };
  var doc = root.document;
  if (!doc) return;
  function mount() {
    var panel = doc.getElementById('notification-center'), toggle = doc.getElementById('notification-toggle');
    var Store = root.HRCStore, UI = root.HRCUI;
    if (!panel || !toggle || !Store || !UI) return;
    var list = doc.getElementById('notification-list'), badge = doc.getElementById('notification-count');
    var all = doc.getElementById('notification-read-all'), status = doc.getElementById('notification-status');
    var filters = doc.getElementById('notification-filters'), drawer = panel.querySelector('[role=dialog]');
    var hashes = {}, ticket = 0, canHash = !!(root.crypto && root.crypto.subtle && root.TextEncoder);
    var account = '', read = {}, items = [], filter = 'all', previous = null, overflow = '', oldInert = false;
    function accountKey() {
      var u = Store.currentUser();
      return u ? 'hrc-notifications-read:v1:' + ((root.HRCSupabaseConfig || {}).url || 'offline') + ':' + (u.authId || u.username) + ':' + u.role : '';
    }
    function loadRead() {
      read = {};
      try {
        var ids = JSON.parse(root.localStorage.getItem(account) || '[]');
        if (Array.isArray(ids)) ids.slice(-600).forEach(function (id) { if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) read[id] = true; });
      } catch (e) { /* Private browsing: read state remains in memory. */ }
    }
    function saveRead() {
      if (!canHash) return; // Never persist raw card/event IDs without a digest.
      try { root.localStorage.setItem(account, JSON.stringify(Object.keys(read).slice(-600))); } catch (e) { }
    }
    function close(restore) {
      if (panel.hidden) return;
      panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
      doc.body.style.overflow = overflow;
      doc.getElementById('app-shell').inert = oldInert;
      if (restore && Store.currentUser()) toggle.focus();
    }
    async function render() {
      var revision = ++ticket;
      var key = accountKey();
      if (key !== account) { close(false); account = key; hashes = {}; loadRead(); previous = null; filter = 'all'; list.textContent = ''; doc.getElementById('notification-live').textContent = ''; }
      if (!account) {
        items = []; previous = null; list.textContent = ''; doc.getElementById('notification-live').textContent = ''; badge.textContent = '0'; badge.hidden = true;
        toggle.disabled = true; toggle.removeAttribute('data-priority'); var summary = doc.getElementById('notification-priority-summary'); if (summary) { summary.textContent = ''; summary.dataset.urgent = 'false'; } return;
      }
      toggle.disabled = false;
      var rows = build(Store.db(), Store.currentUser()), cache = hashes, scope = account;
      var missing = rows.filter(function (n) { return !cache[n.id]; });
      if (missing.length) await Promise.all(missing.map(async function (n) {
        try {
          if (!canHash) throw new Error('session-only');
          var digest = await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(scope + '\0' + n.id));
          cache[n.id] = Array.prototype.map.call(new Uint8Array(digest), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        } catch (e) { canHash = false; cache[n.id] = 'session:' + n.id; }
      }));
      if (revision !== ticket || account !== accountKey()) return false;
      items = rows;
      if (!canHash) doc.getElementById('notification-read-note').textContent = 'حالة القراءة لهذه الجلسة فقط؛ الحفظ الآمن غير متاح في هذا المتصفح.';
      var cloud = Store.cloudStatus(), ready = !(root.HRCSupabaseConfig || {}).enabled || (cloud.state === 'on' && cloud.role === 'staff');
      if (ready && previous) {
        var fresh = items.filter(function (n) { return n.kind === 'decision' && !previous[n.id] && !read[hashes[n.id]]; });
        if (fresh.length) {
          UI.toast('info', fresh.length > 1 ? fresh.length + ' قرارات جديدة من أصحاب العمل' : fresh[0].title, fresh[0].jobCode + ' — افتح الإشعارات للتفاصيل والسبب.');
          doc.getElementById('notification-live').textContent = fresh[0].title + ' — ' + fresh[0].jobCode;
        }
      }
      previous = ready ? items.reduce(function (m, n) { m[n.id] = true; return m; }, {}) : null;
      var unread = items.filter(function (n) { return !read[hashes[n.id]]; }).length;
      badge.textContent = unread > 99 ? '99+' : String(unread); badge.hidden = !unread;
      toggle.setAttribute('aria-label', 'الإشعارات، ' + unread + ' غير مقروءة');
      all.disabled = !unread;
      status.textContent = cloud.state === 'on' ? 'تتحدث مع مزامنة بيانات الشركة' : cloud.state === 'connecting' ? 'جارٍ مزامنة آخر التحديثات…' : 'آخر بيانات متاحة — لا يوجد اتصال مباشر حالياً';
      var highest = items.filter(function (n) { return !read[hashes[n.id]]; }).sort(function (a, b) { return SECTIONS[a.section].rank - SECTIONS[b.section].rank; })[0];
      if (highest) toggle.setAttribute('data-priority', highest.section); else toggle.removeAttribute('data-priority');
      var criticalUnread = items.filter(function (n) { return n.section === 'alert' && !read[hashes[n.id]]; }).length;
      if (criticalUnread) toggle.setAttribute('aria-label', 'الإشعارات، ' + unread + ' غير مقروءة، منها ' + criticalUnread + ' حرجة');
      var summary = doc.getElementById('notification-priority-summary');
      if (summary) { summary.textContent = criticalUnread ? criticalUnread + ' إشعارات حرجة غير مقروءة — راجعها أولاً' : 'الأولوية أولاً · الأحدث داخل كل قسم'; summary.dataset.urgent = String(!!criticalUnread); }
      filters.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
        var count = b.querySelector('[data-filter-count]');
        if (count) count.textContent = String(b.dataset.filter === 'all' ? items.length : b.dataset.filter === 'unread' ? unread : items.filter(function (n) { return n.section === b.dataset.filter; }).length);
      });
      var visible = items.filter(function (n) { return filter === 'all' || (filter === 'unread' ? !read[hashes[n.id]] : n.section === filter); });
      visible.sort(function (a, b) { return SECTIONS[a.section].rank - SECTIONS[b.section].rank || b.time - a.time || a.id.localeCompare(b.id); });
      var lastSection = '';
      list.innerHTML = visible.length ? visible.map(function (n) {
        var section = SECTIONS[n.section], heading = '';
        if (lastSection !== n.section) {
          lastSection = n.section;
          var count = visible.filter(function (v) { return v.section === n.section; }).length;
          heading = '<li role="presentation" class="notice-group" data-section="' + n.section + '"><h3>' + UI.esc(section.label) + '<span>' + count + '</span></h3><p>' + UI.esc(section.hint) + '</p></li>';
        }
        var icon = n.section === 'alert' ? 'alert' : n.kind === 'booking' ? 'hourglass' : n.kind === 'decision' ? 'briefcase' : 'refresh';
        return heading + '<li data-section="' + n.section + '" class="notice-item ' + (read[hashes[n.id]] ? '' : 'notice-unread') + '"><div class="notice-icon">' + UI.ic(icon) + '</div><div class="notice-content">' +
          '<div class="notice-tags"><span class="notice-priority">' + UI.esc(section.label) + '</span></div><div class="notice-heading"><h3>' + UI.esc(n.title) + '</h3>' + ('<span class="notice-state">' + (read[hashes[n.id]] ? 'مقروء' : '<span class="notice-dot" aria-hidden="true"></span>غير مقروء') + '</span>') + '</div>' +
          (n.jobCode ? '<p class="notice-job"><bdi>' + UI.esc(n.jobCode) + '</bdi> · ' + UI.esc(n.jobTitle) + '</p>' : '') +
          '<p>' + UI.esc(n.body) + '</p>' + (n.reason ? '<p class="notice-reason"><strong>السبب:</strong> ' + UI.esc(n.reason) + '</p>' : '') +
          '<time datetime="' + UI.esc(n.at) + '">' + UI.esc(Store.fmtDateTime(n.at)) + '</time><div class="notice-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-notice-open="' + UI.esc(n.id) + '">عرض التفاصيل</button>' +
          (!read[hashes[n.id]] ? '<button type="button" class="btn btn-ghost btn-sm" data-notice-read="' + UI.esc(n.id) + '">تحديد كمقروء</button>' : '') + '</div></div></li>';
      }).join('') : '<li class="notice-empty">' + UI.ic('check') + '<h3>كل شيء مرتب</h3><p>ماكو إشعارات بهذا التصنيف حالياً.</p></li>';
      return true;
    }
    toggle.addEventListener('click', async function () {
      if (!panel.hidden) return close(true);
      if (!Store.currentUser()) return;
      if (!await render() || !Store.currentUser()) return;
      overflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden';
      oldInert = !!doc.getElementById('app-shell').inert; doc.getElementById('app-shell').inert = true;
      panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      doc.getElementById('notification-close').focus();
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-notice-dismiss]')) return close(true);
      var button = e.target.closest('[data-notice-read],[data-notice-open]');
      if (!button || !Store.currentUser()) return;
      var id = button.dataset.noticeRead || button.dataset.noticeOpen;
      var item = items.filter(function (n) { return n.id === id; })[0];
      if (!item) return;
      read[hashes[id]] = true; saveRead();
      if (button.hasAttribute('data-notice-open')) {
        close(true);
        doc.dispatchEvent(new root.CustomEvent('hrc:notification-open', { detail: { view: item.view, jobCode: item.jobCode, serial: item.serial } }));
      }
      render();
      if (!panel.hidden) all.focus();
    });
    all.addEventListener('click', function () { if (!Store.currentUser()) return; items.forEach(function (n) { read[hashes[n.id]] = true; }); saveRead(); render(); });
    filters.addEventListener('click', function (e) { var b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; render(); } });
    doc.addEventListener('keydown', function (e) {
      if (panel.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      if (e.key !== 'Tab') return;
      var focusable = Array.prototype.slice.call(drawer.querySelectorAll('button:not(:disabled),[tabindex="0"]')).filter(function (el) { return el.getClientRects().length; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (doc.activeElement === first || !drawer.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (doc.activeElement === last || !drawer.contains(doc.activeElement))) { e.preventDefault(); first.focus(); }
    });
    root.addEventListener('storage', function (e) { if (e.key === account) { loadRead(); render(); } });
    Store.subscribe(render);
    if (Store.onCloudStatus) Store.onCloudStatus(render);
    root.HRCNotifications.refresh = render;
    render();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
})(typeof window !== 'undefined' ? window : globalThis);
