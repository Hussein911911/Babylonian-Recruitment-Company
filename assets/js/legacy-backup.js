/* Demo-only compatibility. Never used by the production recovery console. */
(function(root){'use strict';var Store=root.HRCStore,UI=root.HRCUI;
function renderCurrent(){if(root.HRCRefresh)root.HRCRefresh();}
function snapshotStatuses(){}
function renderSettings(){renderCurrent();renderLegacyStatus();}
function bindOnce(el,ev,fn){if(!el||el['legacy_'+ev])return;el['legacy_'+ev]=true;el.addEventListener(ev,fn);}
  /* نسخة خارجية مشفّرة للابتوب: كلمة المرور لا تُرسل إلى أي خادم. */
  function encryptedBackup(text, password) {
    if (!root.crypto || !root.crypto.subtle) return Promise.reject(new Error('المتصفح لا يدعم التشفير الآمن'));
    var enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) { return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']); })
      .then(function (key) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text)); })
      .then(function (buf) {
        function b64(x) { var a = new Uint8Array(x), out = ''; for (var i = 0; i < a.length; i += 0x8000) out += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(out); }
        return JSON.stringify({ format: 'HRC-ENCRYPTED-BACKUP-v1', algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: 250000, salt: b64(salt), iv: b64(iv), data: b64(buf) });
      });
  }

  /* Versioned, bounded PBKDF2 + authenticated AES-GCM decryption. */
  function ub64(s) {
    var bin = atob(String(s || '')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isEncryptedBackup(text) {
    try {
      var o = JSON.parse(text);
      return !!(o && o.format === 'HRC-ENCRYPTED-BACKUP-v1' && o.salt && o.iv && o.data);
    } catch (e) { return false; }
  }

  function decryptBackup(text, password) {
    if (!root.crypto || !root.crypto.subtle) return Promise.reject(new Error('المتصفح لا يدعم التشفير الآمن'));
    var pkg;
    try { pkg = JSON.parse(text); } catch (e) { return Promise.reject(new Error('الملف ليس بصيغة JSON صالحة')); }
    if (!pkg || pkg.format !== 'HRC-ENCRYPTED-BACKUP-v1') return Promise.reject(new Error('هذا ليس ملف نسخة مشفّرة من النظام'));
    if (!pkg.salt || !pkg.iv || !pkg.data) return Promise.reject(new Error('ملف النسخة المشفّرة ناقص أو تالف'));
    var salt, iv, data;
    try { salt = ub64(pkg.salt); iv = ub64(pkg.iv); data = ub64(pkg.data); }
    catch (e) { return Promise.reject(new Error('ملف النسخة المشفّرة تالف')); }
    var iters = Number(pkg.iterations);
    if (!Number.isInteger(iters) || iters < 100000 || iters > 1000000 || salt.length !== 16 || iv.length !== 12 || data.length < 16) return Promise.reject(new Error('معايير تشفير غير مدعومة'));
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) { return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: iters, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']); })
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data); })
      .catch(function () { throw new Error('كلمة المرور غير صحيحة أو الملف معدَّل'); })
      .then(function (buf) { return new TextDecoder().decode(buf); });
  }

  function reviewImportedBackup(text) {
    var p = Store.previewBackup(text), cloud = Store.cloudStatus();
    var summary = p.jobs + ' وظيفة و' + p.applicants + ' بطاقة و' + p.attempts + ' فرصة.';
    if (cloud.enforceAuth || (cloud.state === 'on' && cloud.role === 'staff')) {
      UI.modal({ title: 'معاينة فقط — لا استعادة على الموقع', body: '<p>' + UI.esc(summary) + '</p><p>الملف نسخة متصفح وليس قاعدة PostgreSQL كاملة. الاستعادة تختبر في بيئة معزولة؛ بيانات الموقع لم تتغير.</p>', footer: '<button class="btn btn-outline" data-close>إغلاق</button>' });
      return Promise.resolve(false);
    }
    return UI.confirm({ title: 'معاينة واعتماد النسخة', danger: true, confirmText: 'اعتماد محلي',
      message: summary + ' سيجري الاستبدال محلياً فقط بعد نجاح حفظ نسخة أمان. هل تعتمد؟'
    }).then(function (ok) { if (!ok) return false; Store.importJson(text); UI.toast('ok', 'تم الاستيراد المحلي', 'حُفظت نسخة أمان واستعيدت بيانات الاختبار.'); renderCurrent(); return true; });
  }


function renderLegacyStatus(){var backups=Store.listBackupMeta();
    // عرض حالة الجدولة التلقائية + آخر نسخة
    var DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var scheduleStatus = document.getElementById('schedule-status');
    if (scheduleStatus) {
      var schedule = Store.getAutoSchedule();
      var html = '';
      if (schedule) {
        var selectedDays = schedule.days.map(function (d) { return DAY_NAMES[d]; }).join('، ');
        html = '<b style="color:var(--ok)">✓ مفعّل</b> — ' + UI.esc(selectedDays) + ' الساعة ' + UI.esc(schedule.time);
        var lastRun = Store.lastAutoRun();
        html += '<br>آخر تنفيذ تلقائي: ' + (lastRun ? UI.esc(String(lastRun).replace('T', ' الساعة ')) : 'لم يُنفَّذ بعد');
      } else {
        html = '<span style="color:var(--muted)">لم يتم تفعيل الجدولة بعد</span>';
      }
      var lastAuto = backups.filter(function (b) { return b.auto; }).slice(-1)[0];
      if (lastAuto) html += '<br>آخر نسخة تلقائية محفوظة: ' + UI.esc(lastAuto.name) + ' — ' + UI.esc(Store.fmtDateTime(lastAuto.createdAt));
      if (Store.cloudStatus().enforceAuth) html = '<b>جدولة المتصفح متوقفة لحماية الخصوصية.</b><br>وكيل PostgreSQL: لم يربط بهذا الموقع؛ آخر نجاح والموعد التالي غير متحققين هنا. حالته الفعلية تظهر من لابتوب المكتب بعد إعداده.';
      scheduleStatus.innerHTML = html;
      var prepared = document.getElementById('backup-last-export');
      if (prepared) { var stamp = null; try { stamp = localStorage.getItem('hrc-encrypted-export-prepared'); } catch (e) {} prepared.textContent = stamp ? Store.fmtDateTime(stamp) + ' — جهز للتنزيل، تأكد من حفظه' : 'لم يجهز ملف على هذا الجهاز بعد'; }
      var legacy = document.getElementById('backup-legacy-warning');
      if (legacy) { legacy.hidden = !backups.length; legacy.textContent = 'توجد ' + backups.length + ' لقطات قديمة غير مشفرة في هذا المتصفح. للمدير فقط: صدّرها مشفرة ثم احذفها من «عرض اللقطات القديمة» إذا لم تعد مطلوبة.'; }
    }

    ['btn-reset', 'btn-export'].forEach(function (id) { var button = document.getElementById(id); if (button) button.classList.toggle('hidden', Store.cloudStatus().enforceAuth); });

    // إخفاء أزرار الجدولة إن لم تكن مفعّلة (تعديل/إيقاف/نفّذ الآن)
    var hasSchedule = !!Store.getAutoSchedule();
    ['btn-edit-schedule', 'btn-disable-schedule', 'btn-run-auto-backup'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.classList.toggle('hidden', !hasSchedule);
    });
}
function bindLegacyEvents(){
    var ma = document.getElementById('btn-maintenance');
    if (ma) ma.addEventListener('click', function () {
      var actions = Store.runMaintenance();
      UI.toast('info', 'قواعد الحجز التلقائي', actions.length ? 'نُفّذت ' + actions.length + ' عملية.' : 'لا إجراءات مطلوبة الآن.');
      renderCurrent();
    });

    var ex = document.getElementById('btn-export');
    if (ex) ex.addEventListener('click', function () {
      if (!Store.isAdmin()) return;
      if (Store.cloudStatus().enforceAuth) { document.getElementById('btn-export-encrypted').click(); return; }
      UI.download('hrc-backup-' + Store.fmtDate(new Date()) + '.json', Store.exportJson(), 'application/json');
      UI.toast('ok', 'تصدير النسخة', 'حُفظ ملف JSON يحتوي كل البيانات والسجلات.');
    });
    var exEncrypted = document.getElementById('btn-export-encrypted');
    if (exEncrypted) exEncrypted.addEventListener('click', function () {
      if (!Store.isAdmin()) return;
      var p1 = window.prompt('اكتب كلمة مرور قوية للنسخة المشفّرة:');
      if (!p1 || p1.length < 10) { UI.toast('warn', 'كلمة المرور قصيرة', 'استخدم 10 أحرف أو أكثر واحفظها خارج الموقع.'); return; }
      var p2 = window.prompt('أعد كتابة كلمة المرور:');
      if (p1 !== p2) { UI.toast('err', 'لم تتطابق كلمتا المرور', 'لم يتم إنشاء النسخة.'); return; }
      exEncrypted.disabled = true;
      encryptedBackup(Store.exportJson(), p1).then(function (data) {
        UI.download('HRC-backup-' + Store.fmtDate(new Date()) + '.brc.enc.json', data, 'application/json');
        try { localStorage.setItem('hrc-encrypted-export-prepared', new Date().toISOString()); } catch (e) {}
        UI.toast('ok', 'جُهّز الملف المشفّر للتنزيل', 'لقطة بيانات المتصفح فقط؛ تأكد من حفظ الملف وكلمة المرور بمكانين آمنين.');
        renderSettings();
      }).catch(function (e) { UI.toast('err', 'فشل التشفير', e.message); }).then(function () { exEncrypted.disabled = false; });
    });

    var im = document.getElementById('btn-import');
    var imf = document.getElementById('import-file');
    if (im && imf) {
      im.addEventListener('click', function () { imf.click(); });
      imf.addEventListener('change', function () {
        var f = imf.files[0]; if (!f || !Store.isAdmin()) return;
        if (f.size > 32 * 1024 * 1024) { UI.toast('err', 'ملف كبير', 'الحد 32 ميغابايت'); return; }
        var r = new FileReader();
        r.onload = function () {
          var text = String(r.result);
          /* ملف مشفّر أُدخل من الزر الخطأ: نوجّه المستخدم بدل رسالة «غير صالح» المضلّلة */
          if (isEncryptedBackup(text)) {
            UI.toast('warn', 'هذه نسخة مشفّرة', 'استخدم زر «استرداد نسخة مشفّرة» وأدخل كلمة المرور.');
            imf.value = ''; return;
          }
          try { reviewImportedBackup(text).catch(function (e) { UI.toast('err', 'فشل الاستيراد', e.message); }); }
          catch (e) { UI.toast('err', 'فشل الاستيراد', 'الملف غير صالح: ' + e.message); }
          imf.value = '';
        };
        r.readAsText(f);
      });
    }

    var ime = document.getElementById('btn-import-encrypted'), imef = document.getElementById('import-enc-file');
    if (ime && imef) {
      ime.addEventListener('click', function () { if (Store.isAdmin()) imef.click(); });
      imef.addEventListener('change', function () {
        var f = imef.files[0]; if (!f || !Store.isAdmin()) return;
        if (f.size > 32 * 1024 * 1024) { UI.toast('err', 'ملف كبير', 'الحد 32 ميغابايت'); return; }
        var r = new FileReader();
        r.onload = function () {
          var text = String(r.result); imef.value = '';
          var job;
          if (!isEncryptedBackup(text)) job = Promise.resolve(text);
          else {
            var pw = window.prompt('أدخل كلمة مرور النسخة المشفّرة:');
            if (!pw) return;
            job = decryptBackup(text, pw);
          }
          ime.disabled = true;
          job.then(reviewImportedBackup).catch(function (e) { UI.toast('err', 'فشل الاسترداد', e.message); })
            .then(function () { ime.disabled = false; });
        };
        r.readAsText(f);
      });
    }
    var rs = document.getElementById('btn-reset');
    if (rs) rs.addEventListener('click', function () {
      UI.confirm({
        title: 'إعادة ضبط البيانات', danger: true, confirmText: 'حذف وإعادة التهيئة',
        message: 'سيتم حذف كل الوظائف والاستمارات والسجلات المحلية وإعادة البيانات التجريبية. لا يمكن التراجع.'
      }).then(function (ok) {
        if (!ok) return;
        Store.resetDemo(); renderCurrent(); snapshotStatuses();
        UI.toast('warn', 'أُعيد الضبط', 'النظام يعمل على البيانات التجريبية.');
      });
    });


}
  function bindBackupActions() {
    bindOnce(document.getElementById('btn-schedule-backup'), 'click', scheduleBackupModal);
    bindOnce(document.getElementById('btn-edit-schedule'), 'click', scheduleBackupModal);
    bindOnce(document.getElementById('btn-view-backups'), 'click', viewBackupsModal);

    bindOnce(document.getElementById('btn-quick-backup'), 'click', function () {
      if (!Store.isAdmin()) return;
      if (Store.cloudStatus().enforceAuth) { document.getElementById('btn-export-encrypted').click(); return; }
      var name = 'نسخة سريعة - ' + Store.fmtDateTime(new Date());
      var backup = Store.saveScheduledBackup(name, null);
      if (backup) {
        UI.toast('ok', 'تم الحفظ', 'حُفظت النسخة الاحتياطية: ' + name + ' (' + (backup.size / 1024).toFixed(1) + ' ك.ب)');
      } else {
        UI.toast('err', 'فشل الحفظ', Store.lastBackupErrorMessage() || 'لم يتم حفظ النسخة الاحتياطية');
      }
      renderSettings();
    });

    bindOnce(document.getElementById('btn-run-auto-backup'), 'click', function () {
      var backup = Store.saveScheduledBackup('نسخة تلقائية يدوية - ' + Store.fmtDateTime(new Date()), null, { auto: true });
      if (backup) UI.toast('ok', 'تم التنفيذ', 'أُنشئت النسخة التلقائية: ' + backup.name);
      else UI.toast('err', 'فشل التنفيذ', Store.lastBackupErrorMessage() || 'تعذّر إنشاء النسخة');
      renderSettings();
    });

    bindOnce(document.getElementById('btn-disable-schedule'), 'click', function () {
      UI.confirm({
        title: 'إيقاف الجدولة',
        danger: true,
        confirmText: 'إيقاف',
        message: 'سيتم إيقاف النسخ الاحتياطي التلقائي المجدول. النسخ المحفوظة تبقى كما هي. هل أنت متأكد؟'
      }).then(function (ok) {
        if (!ok) return;
        Store.clearAutoSchedule();
        UI.toast('ok', 'تم الإيقاف', 'أُوقفت الجدولة التلقائية');
        renderSettings();
      });
    });
  }

  /* نافذة جدولة النسخ الاحتياطي */
  function scheduleBackupModal() {
    if (Store.cloudStatus().enforceAuth) { UI.toast('info', 'الجدولة مستقلة عن المتصفح', 'جهّز وكيل PostgreSQL ومهمة ويندوز؛ لا توجد جدولة خادم مفعلة من هذا الزر.'); return; }
    var schedule = Store.getAutoSchedule();

    var days = [
      { id: 0, name: 'الأحد' },
      { id: 1, name: 'الإثنين' },
      { id: 2, name: 'الثلاثاء' },
      { id: 3, name: 'الأربعاء' },
      { id: 4, name: 'الخميس' },
      { id: 5, name: 'الجمعة' },
      { id: 6, name: 'السبت' }
    ];

    var body = '<form id="backup-form">' +
      '<div class="field mb-2">' +
      '<label for="backup-name">اسم النسخة الاحتياطية *</label>' +
      '<input type="text" id="backup-name" required placeholder="مثال: نسخة نهاية الشهر">' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>نطاق البيانات</label>' +
      '<div class="flex" style="gap:8px">' +
      '<label style="display:flex;align-items:center;gap:4px"><input type="radio" name="backup-range" value="all" checked style="width:auto"> كل البيانات</label>' +
      '<label style="display:flex;align-items:center;gap:4px"><input type="radio" name="backup-range" value="custom" style="width:auto"> نطاق مخصص</label>' +
      '</div>' +
      '</div>' +
      '<div id="custom-range" style="display:none">' +
      '<div class="flex" style="gap:8px">' +
      '<div class="field" style="flex:1"><label for="backup-from">من تاريخ</label><input type="date" id="backup-from"></div>' +
      '<div class="field" style="flex:1"><label for="backup-to">إلى تاريخ</label><input type="date" id="backup-to"></div>' +
      '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>الجدولة التلقائية</label>' +
      '<div class="flex" style="gap:8px;flex-wrap:wrap">' +
      '<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="backup-auto" style="width:auto" ' + (schedule ? 'checked' : '') + '> تفعيل الجدولة التلقائية</label>' +
      '</div>' +
      '</div>' +
      '<div id="schedule-options" style="display:' + (schedule ? 'block' : 'none') + '">' +
      '<div class="field mb-2">' +
      '<label>أيام الأسبوع</label>' +
      '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
      days.map(function(day) {
        var checked = schedule && schedule.days && schedule.days.indexOf(day.id) >= 0 ? 'checked' : '';
        return '<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:#f4f6fb;border-radius:6px">' +
          '<input type="checkbox" name="backup-days" value="' + day.id + '" style="width:auto" ' + checked + '> ' + day.name + '</label>';
      }).join('') +
      '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label for="backup-time">وقت النسخ</label>' +
      '<input type="time" id="backup-time" value="' + (schedule && schedule.time ? schedule.time : '23:00') + '" style="width:150px">' +
      '</div>' +
      '<div class="tiny muted mt-2">' +
      '<b>اقتراح:</b> يمكنك رفع النسخ الاحتياطية إلى Google Drive أو Dropbox يدوياً للحفاظ عليها.' +
      '</div>' +
      '</div>' +
      '</form>';

    UI.modal({
      title: 'جدولة النسخ الاحتياطي',
      subtitle: 'احفظ نسخة احتياطية من البيانات مع جدولة تلقائية',
      body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="backup-save">' + UI.ic('check') + ' حفظ</button>',
      onMount: function (box, close) {
        var radios = box.querySelectorAll('input[name="backup-range"]');
        var customRange = box.querySelector('#custom-range');
        var autoCheck = box.querySelector('#backup-auto');
        var scheduleOptions = box.querySelector('#schedule-options');

        radios.forEach(function(radio) {
          radio.addEventListener('change', function() {
            customRange.style.display = this.value === 'custom' ? 'block' : 'none';
          });
        });

        autoCheck.addEventListener('change', function() {
          scheduleOptions.style.display = this.checked ? 'block' : 'none';
        });

        box.querySelector('#backup-save').addEventListener('click', function () {
          var name = box.querySelector('#backup-name').value.trim();
          if (!name) {
            UI.toast('err', 'اسم مطلوب', 'يرجى إدخال اسم للنسخة الاحتياطية');
            return;
          }

          var rangeType = box.querySelector('input[name="backup-range"]:checked').value;
          var dateRange = null;

          if (rangeType === 'custom') {
            var from = box.querySelector('#backup-from').value;
            var to = box.querySelector('#backup-to').value;
            if (!from || !to) {
              UI.toast('err', 'تواريخ مطلوبة', 'يرجى تحديد نطاق التاريخ');
              return;
            }
            dateRange = { from: from, to: to };
          }

          var backup = Store.saveScheduledBackup(name, dateRange);
          if (!backup) {
            UI.toast('err', 'فشل الحفظ', Store.lastBackupErrorMessage() || 'لم يتم حفظ النسخة الاحتياطية');
            return;
          }

          // حفظ الجدولة التلقائية عبر المتجر (مصدر واحد للحقيقة)
          if (autoCheck.checked) {
            var selectedDays = [];
            box.querySelectorAll('input[name="backup-days"]:checked').forEach(function (cb) {
              selectedDays.push(Number(cb.value));
            });
            var time = box.querySelector('#backup-time').value || '23:00';

            if (selectedDays.length === 0) {
              UI.toast('warn', 'حُفظت النسخة فقط', 'اختر يوماً واحداً على الأقل لتفعيل الجدولة التلقائية');
            } else if (Store.saveAutoSchedule(selectedDays, time)) {
              var DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
              UI.toast('ok', 'تم الحفظ', 'حُفظت النسخة وتفعّلت الجدولة: ' +
                selectedDays.map(function (d) { return DAY_NAMES[d]; }).join('، ') + ' الساعة ' + time);
            } else {
              UI.toast('err', 'حُفظت النسخة فقط', Store.lastBackupErrorMessage() || 'تعذّر حفظ الجدولة');
            }
          } else {
            UI.toast('ok', 'تم الحفظ', 'حُفظت النسخة الاحتياطية: ' + backup.name);
          }

          renderSettings();
          close();
        });
      }
    });
  }

  /* نافذة عرض النسخ الاحتياطية */
  function viewBackupsModal() {
    var backups = Store.listBackupMeta().slice().reverse();   // الأحدث أولاً

    var body = '<div class="table-wrap"><div class="table-scroll"><table class="data" style="min-width:720px">' +
      '<thead><tr><th>الاسم</th><th>تاريخ الإنشاء</th><th>النطاق</th><th>الحجم</th><th>إجراءات</th></tr></thead>' +
      '<tbody>' +
      (backups.length === 0 ? '<tr><td colspan="5" class="table-empty">لا توجد نسخ احتياطية</td></tr>' :
        backups.map(function (b) {
          var tags = (b.auto ? ' <span class="badge ok">تلقائية</span>' : '') +
                     (b.partial ? ' <span class="badge warn">نطاق مخصص</span>' : '');
          return '<tr>' +
            '<td><b>' + UI.esc(b.name) + '</b>' + tags + '</td>' +
            '<td class="tiny">' + UI.esc(Store.fmtDateTime(b.createdAt)) + '</td>' +
            '<td class="tiny">' + (b.dateRange ? UI.esc(b.dateRange.from + ' إلى ' + b.dateRange.to) : 'كل البيانات') +
              (b.records ? '<br><span class="muted">' + UI.esc(b.records.applicants) + ' بطاقة · ' + UI.esc(b.records.audit) + ' سجل</span>' : '') + '</td>' +
            '<td class="tiny">' + ((b.size || 0) / 1024).toFixed(1) + ' ك.ب</td>' +
            '<td><div class="cell-actions">' +
            '<button class="btn btn-outline btn-sm" data-backup-export="' + UI.esc(b.id) + '">' + UI.ic('download') + ' تصدير</button>' +
            '<button class="btn btn-ok btn-sm" data-backup-restore="' + UI.esc(b.id) + '">' + UI.ic('refresh') + ' استعادة</button>' +
            '<button class="btn btn-danger btn-sm" data-backup-delete="' + UI.esc(b.id) + '" aria-label="حذف النسخة">' + UI.ic('trash') + '</button>' +
            '</div></td></tr>';
        }).join('')) +
      '</tbody></table></div></div>';

    UI.modal({
      title: 'النسخ الاحتياطية',
      subtitle: backups.length + ' لقطة متصفح قديمة غير مشفرة — لا تغني عن قاعدة البيانات. صدّرها بأمان واحذفها من الجهاز المشترك عند الحاجة.',
      wide: true,
      body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        box.querySelectorAll('[data-backup-export]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-backup-export');
            var data = Store.exportScheduledBackup(id);
            if (data) {
              if (Store.cloudStatus().enforceAuth) {
                var pw = window.prompt('كلمة مرور 10 أحرف أو أكثر لتشفير اللقطة القديمة:');
                if (!pw || pw.length < 10 || window.prompt('أعد كتابة كلمة مرور اللقطة:') !== pw) return;
                encryptedBackup(data, pw).then(function (encrypted) { UI.download('HRC-legacy.brc.enc.json', encrypted, 'application/json'); }).catch(function (e) { UI.toast('err', 'فشل التشفير', e.message); });
                return;
              }
              UI.download('hrc-backup-' + Store.fmtDate(new Date()) + '.json', data, 'application/json');
              UI.toast('ok', 'تم التصدير', 'حُفظ ملف النسخة الاحتياطية');
            } else {
              UI.toast('err', 'فشل التصدير', 'النسخة غير موجودة أو لا تحتوي بيانات');
            }
          });
        });

        box.querySelectorAll('[data-backup-restore]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-backup-restore');
            if (Store.cloudStatus().enforceAuth) { reviewImportedBackup(Store.exportScheduledBackup(id)); return; }
            var meta = Store.listBackupMeta().filter(function (b) { return b.id === id; })[0] || {};
            UI.confirm({
              title: 'استعادة النسخة الاحتياطية',
              danger: true,
              confirmText: 'استعادة',
              message: meta.partial
                ? 'هذه نسخة بنطاق مخصص: ستُدمَج استماراتها وسجلاتها مع البيانات الحالية (لن يُحذف شيء). تُحفظ نسخة أمان تلقائياً قبل الاستعادة.'
                : 'سيتم استبدال البيانات الحالية ببيانات النسخة «' + (meta.name || '') + '». تُحفظ نسخة أمان تلقائياً قبل الاستعادة. هل أنت متأكد؟'
            }).then(function (ok) {
              if (!ok) return;
              if (Store.restoreScheduledBackup(id)) {
                UI.toast('ok', 'تمت الاستعادة', 'استُعيدت البيانات بنجاح');
                snapshotStatuses();
                renderCurrent();
                close();
              } else {
                UI.toast('err', 'فشل الاستعادة', Store.lastBackupErrorMessage() || 'لم يتم استعادة البيانات');
              }
            });
          });
        });

        box.querySelectorAll('[data-backup-delete]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-backup-delete');
            UI.confirm({
              title: 'حذف النسخة الاحتياطية',
              danger: true,
              confirmText: 'حذف',
              message: 'سيتم حذف النسخة الاحتياطية نهائياً. هل أنت متأكد؟'
            }).then(function(ok) {
              if (ok) {
                if (Store.deleteScheduledBackup(id)) {
                  UI.toast('ok', 'تم الحذف', 'حُذفت النسخة الاحتياطية');
                  close();
                  renderSettings();
                  viewBackupsModal(); // إعادة فتح النافذة بالقائمة المحدّثة
                } else {
                  UI.toast('err', 'فشل الحذف', 'لم يتم حذف النسخة الاحتياطية');
                }
              }
            });
          });
        });
      }
    });
  }


root.HRCLegacyBackup={mount:function(){if(Store.cloudStatus().enforceAuth)return;var box=document.getElementById('recovery-tools');if(!box)return;if(!box.dataset.legacyReady){box.dataset.legacyReady='yes';box.innerHTML="<div class=\"panel settings-quick-backup\"><div><h3>نسخة احتياطية</h3><p class=\"small muted mb-0\">تنزيل لقطة مشفّرة بكلمة مرور؛ لا تعادل نسخة كاملة من قاعدة الموقع.</p></div><button class=\"btn btn-gold\" id=\"btn-quick-backup\"><svg class=\"ic\"><use href=\"#i-download\" xlink:href=\"#i-download\"></use></svg> تنزيل نسخة مشفّرة</button></div><div class=\"panel\" id=\"settings-backup-tools\">\n<div class=\"panel-head\"><h3><svg class=\"ic\"><use href=\"#i-server\" xlink:href=\"#i-server\"></use></svg> النسخ الاحتياطي والصيانة</h3></div>\n<div class=\"panel-body\">\n<div class=\"backup-assurance\"><span class=\"backup-eyebrow\">حماية البيانات · بدون وعود مضللة</span><h4>ثلاث طبقات، لكل واحدة دور واضح</h4><div class=\"backup-layers\"><article><b>01 · نسخة المتصفح</b><p>تصدير مشفّر للبيانات المحملة فقط؛ ليست نسخة PostgreSQL ولا تشمل ملفات المشروع.</p><small id=\"backup-last-export\">لم يجهز ملف على هذا الجهاز بعد</small></article><article><b>02 · قاعدة الشركة</b><p>وكيل مستقل مشفّر + مهمة ويندوز. يحتاج إعداد اللابتوب ومفتاح استرداد منفصل.</p><small>التشغيل وآخر نجاح غير متحققين في هذه الصفحة</small></article><article><b>03 · عمل المكتب المحلي</b><p>طلبات مشتركة أثناء الانقطاع، ثم تحقق ومزامنة؛ ليست حجوزات نهائية قبل الاعتماد.</p><small>يتطلب تثبيت بوابة المكتب وHTTPS على شبكة الشركة</small></article></div></div>\n<p id=\"backup-legacy-warning\" class=\"tiny muted\" hidden></p>\n<div class=\"flex flex-wrap\" style=\"gap:8px\">\n<button class=\"btn btn-outline\" id=\"btn-export\"><svg class=\"ic\"><use href=\"#i-download\" xlink:href=\"#i-download\"></use></svg> تصدير آمن</button>\n<button class=\"btn btn-outline\" id=\"btn-export-encrypted\"><svg class=\"ic\"><use href=\"#i-lock\" xlink:href=\"#i-lock\"></use></svg> نسخة مشفّرة للابتوب</button>\n<button class=\"btn btn-outline\" id=\"btn-import\"><svg class=\"ic\"><use href=\"#i-upload\" xlink:href=\"#i-upload\"></use></svg> معاينة ملف نسخة</button>\n<button class=\"btn btn-ok\" id=\"btn-import-encrypted\"><svg class=\"ic\"><use href=\"#i-lock\" xlink:href=\"#i-lock\"></use></svg> فك تشفير ومعاينة</button>\n<button class=\"btn btn-lapis\" id=\"btn-schedule-backup\"><svg class=\"ic\"><use href=\"#i-calendar\" xlink:href=\"#i-calendar\"></use></svg> خيارات الجدولة</button>\n<button class=\"btn btn-outline\" id=\"btn-view-backups\"><svg class=\"ic\"><use href=\"#i-list\" xlink:href=\"#i-list\"></use></svg> عرض اللقطات القديمة</button>\n<button class=\"btn btn-warn\" id=\"btn-maintenance\"><svg class=\"ic\"><use href=\"#i-refresh\" xlink:href=\"#i-refresh\"></use></svg> فحص الحجوزات والحالات الحرجة</button>\n<button class=\"btn btn-danger\" id=\"btn-reset\"><svg class=\"ic\"><use href=\"#i-trash\" xlink:href=\"#i-trash\"></use></svg> إعادة ضبط البيانات التجريبية</button>\n</div>\n<input type=\"file\" id=\"import-file\" accept=\"application/json\" class=\"hidden\" aria-label=\"اختيار ملف النسخة الاحتياطية للاستيراد\">\n<input type=\"file\" id=\"import-enc-file\" accept=\".json,.enc,application/json\" class=\"hidden\" aria-label=\"اختيار ملف النسخة الاحتياطية المشفّرة للاسترداد\">\n<div class=\"panel mt-3\" style=\"background:#f9f6ef;border:1px solid var(--line)\">\n<div class=\"panel-body\">\n<h4 style=\"margin-bottom:12px;display:flex;align-items:center;gap:8px\">\n<svg class=\"ic\" style=\"color:var(--gold-3)\"><use href=\"#i-clock\" xlink:href=\"#i-clock\"></use></svg>\n                  حالة النسخ والجدولة المستقلة\n                </h4>\n<div id=\"schedule-status\" class=\"tiny muted\">لم يتم تفعيل الجدولة بعد</div>\n<div class=\"flex flex-wrap mt-2\" style=\"gap:8px\">\n<button class=\"btn btn-outline btn-sm\" id=\"btn-edit-schedule\"><svg class=\"ic\"><use href=\"#i-edit\" xlink:href=\"#i-edit\"></use></svg> تعديل الجدولة</button>\n<button class=\"btn btn-gold btn-sm\" id=\"btn-run-auto-backup\"><svg class=\"ic\"><use href=\"#i-download\" xlink:href=\"#i-download\"></use></svg> نفّذ نسخة الآن</button>\n<button class=\"btn btn-outline btn-sm\" id=\"btn-disable-schedule\"><svg class=\"ic\"><use href=\"#i-x\" xlink:href=\"#i-x\"></use></svg> إيقاف الجدولة</button>\n</div>\n<p class=\"tiny muted mt-2 mb-0\">الاستعادة على الموقع السحابي محظورة من المتصفح حتى للمدير. فحص سلامة الملف لا يعني نجاح استعادته؛ تجربة قاعدة منفصلة لازمة. اللقطات القديمة لا تحذف تلقائياً.</p>\n</div>\n</div>\n<div class=\"data-grid mt-3\">\n<div class=\"data-item\"><div class=\"k\">الوظائف المخزّنة</div><div class=\"v\" id=\"db-jobs\">0</div></div>\n<div class=\"data-item\"><div class=\"k\">الاستمارات</div><div class=\"v\" id=\"db-apps\">0</div></div>\n<div class=\"data-item\"><div class=\"k\">الفرص (خانات)</div><div class=\"v\" id=\"db-attempts\">0</div></div>\n<div class=\"data-item\"><div class=\"k\">سجلات التدقيق</div><div class=\"v\" id=\"db-audit\">0</div></div>\n<div class=\"data-item\"><div class=\"k\">النسخ الاحتياطية</div><div class=\"v\" id=\"db-backups\">0</div></div>\n</div>\n</div>\n</div>";bindLegacyEvents();}bindBackupActions();renderLegacyStatus();}};
if(root.HRCLegacyBackup)root.HRCLegacyBackup.mount();
})(window);
