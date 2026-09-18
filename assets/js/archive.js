/* ════════════════════════════════════════════════════════════════════════════
 *  archive.js — أرشيف الشركة: ملف واحد يُرسل بتلكرام ويفتح الموقع كاملاً
 *  ---------------------------------------------------------------------------
 *  الغاية (طلب الإدارة 2026-09-19): نسخة احتياطية تُرسل إلى تلكرام، ومن يضغط
 *  عليها تفتح **الموقع نفسه** بالوظائف والبيانات — حتى لو تعطّل الموقع الأصلي
 *  أو انتهى اشتراك الاستضافة. الغرض: طمأنة الزبون وإثبات استمرارية الشركة.
 *
 *  كيف يعمل:
 *    نأخذ brc-standalone.html (الموقع كاملاً بملف واحد: CSS + JS + صور + خطوط
 *    مدمجة، يعمل بلا إنترنت) ونحقن فيه **لقطة البيانات الحالية** قبل أي سكربت،
 *    فيقرأها store.js عند الإقلاع بدل البيانات التجريبية.
 *
 *  ⚠️ تنبيه أمني جوهري — اقرأه قبل تعديل أي شيء هنا:
 *    الأرشيف الكامل يحتوي **بيانات شخصية حقيقية**: أسماء المتقدمين وأرقام
 *    هواتفهم وعناوينهم وتواريخ ميلادهم، وأرقام أصحاب العمل الخاصة، وسجل
 *    التدقيق. تحويله (forward) لأي شخص = تسريب بيانات.
 *    لذلك:
 *      • الافتراضي هو الوضع **العام** (وظائف معلنة فقط) — آمن للمشاركة.
 *      • الوضع **الكامل** يتطلب تأكيداً صريحاً، ويُعلَّم في اسم الملف وداخل
 *        الصفحة نفسها بشريط تحذير أحمر لا يمكن تفويته.
 * ════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var TEMPLATE = 'brc-standalone.html';
  var MARK = '<!--BRC_ARCHIVE_DATA-->';      // موضع الحقن داخل القالب

  /* ── تنقية البيانات للوضع العام ─────────────────────────────────────────
     نُبقي ما يراه الزائر على الموقع العام فقط: الوظائف المعلنة بلا بيانات
     صاحب العمل الخاصة. ونحذف تماماً: المتقدمين، المحاولات، سجل التدقيق،
     المستخدمين، النسخ الاحتياطية المخزّنة. */
  function publicSnapshot(db) {
    var out = {
      jobs: (db.jobs || []).map(function (j) {
        var c = JSON.parse(JSON.stringify(j));
        delete c.employer;              // اسم/هاتف/عنوان صاحب العمل — داخلي
        delete c.interviewLocation;     // يُعطى للمرشّح عند الحجز لا للعامة
        delete c.holdBy; delete c.holdSerial;
        return c;
      }),
      settings: db.settings || {},
      applicants: [], attempts: [], audit: [], users: [],
      counters: db.counters || {}
    };
    return out;
  }

  function fullSnapshot(db) {
    return JSON.parse(JSON.stringify(db));
  }

  /* ── شريط التحذير داخل الأرشيف الكامل ───────────────────────────────────
     يظهر فوق كل شيء ولا يُغلق: من يفتح الملف يعرف فوراً أنه يحمل بيانات
     شخصية وأن تحويله ممنوع. نحقنه كـ HTML + CSS مستقلين حتى لا يعتمد على
     أنماط الموقع. */
  function warningBar() {
    return '<div style="position:sticky;top:0;z-index:99999;background:#7f1d1d;color:#fff;' +
      'padding:10px 14px;font:600 14px/1.6 system-ui,sans-serif;text-align:center;' +
      'direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.3)">' +
      '\u26a0\ufe0f \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u064a\u062d\u062a\u0648\u064a <b>\u0628\u064a\u0627\u0646\u0627\u062a \u0634\u062e\u0635\u064a\u0629</b> (\u0623\u0633\u0645\u0627\u0621 \u0648\u0623\u0631\u0642\u0627\u0645 \u0647\u0648\u0627\u062a\u0641 \u0648\u0639\u0646\u0627\u0648\u064a\u0646) \u2014 ' +
      '\u0644\u0644\u0625\u062f\u0627\u0631\u0629 \u0641\u0642\u0637\u060c \u0648\u064a\u064f\u0645\u0646\u0639 \u062a\u062d\u0648\u064a\u0644\u0647 \u0623\u0648 \u0645\u0634\u0627\u0631\u0643\u062a\u0647 \u0645\u0639 \u0627\u0644\u0632\u0628\u0627\u0626\u0646.' +
      '</div>';
  }

  /* ── بناء الأرشيف ───────────────────────────────────────────────────────
     نجلب القالب المستقل بـ fetch. يفشل على file:// (سياسة المتصفح) فنُبلّغ
     برسالة مفهومة بدل خطأ غامض. */
  function build(opts) {
    opts = opts || {};
    var full = !!opts.full;
    /* المتجر مُصدَّر باسم BRCStore (لا Store) — راجع نهاية store.js.
       نقبل الاثنين تحسّباً، لكن BRCStore هو الصحيح في الإنتاج. */
    var S = root.BRCStore || root.Store;
    var db = S && S.exportJson ? JSON.parse(S.exportJson()) : null;
    if (!db) return Promise.reject(new Error('\u0644\u0645 \u062a\u062a\u0648\u0641\u0631 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a'));

    var snapshot = full ? fullSnapshot(db) : publicSnapshot(db);
    var base = (root.BRCNav && root.BRCNav.homeHref) ? root.BRCNav.homeHref() : '';

    return fetch(base + TEMPLATE, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('\u062a\u0639\u0630\u0651\u0631 \u062c\u0644\u0628 \u0642\u0627\u0644\u0628 \u0627\u0644\u0645\u0648\u0642\u0639 (' + res.status + ')');
      return res.text();
    }).then(function (html) {
      var meta = {
        createdAt: new Date().toISOString(),
        mode: full ? 'full' : 'public',
        jobs: (snapshot.jobs || []).length,
        applicants: (snapshot.applicants || []).length
      };

      /* الحقن: سكربت يضع اللقطة في localStorage قبل إقلاع store.js، فيقرأها
         كأنها بيانات الجهاز. نستعمل JSON.parse على نص مُرمَّز بدل كائن حرفي
         حتى لا تكسر أي علامة </script> داخل البيانات صفحةَ الأرشيف. */
      var payload = JSON.stringify(JSON.stringify(snapshot));
      var inject =
        '<script>(function(){try{' +
        'localStorage.setItem("brc_db_v2",' + payload + ');' +
        'localStorage.setItem("brc_archive_meta",' + JSON.stringify(JSON.stringify(meta)) + ');' +
        '}catch(e){}})();<\/script>';

      if (full) inject = inject + warningBar();

      /* نحقن مباشرة بعد <body> ليسبق كل السكربتات */
      var at = html.indexOf('<body');
      if (at < 0) throw new Error('\u0642\u0627\u0644\u0628 \u0627\u0644\u0645\u0648\u0642\u0639 \u063a\u064a\u0631 \u0645\u062a\u0648\u0642\u0639');
      var close = html.indexOf('>', at);
      var out = html.slice(0, close + 1) + inject + html.slice(close + 1);

      return { html: out, meta: meta, name: fileName(full) };
    });
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function fileName(full) {
    var d = new Date();
    var stamp = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
    /* اسم الملف يقول ما بداخله: الزبون يرى «موقع-بابل»، والإداري يرى «خاص» */
    return full
      ? 'BRC-\u0623\u0631\u0634\u064a\u0641-\u062e\u0627\u0635-\u0644\u0644\u0625\u062f\u0627\u0631\u0629-' + stamp + '.html'
      : '\u0634\u0631\u0643\u0629-\u0628\u0627\u0628\u0644-\u0644\u0644\u062a\u0648\u0638\u064a\u0641-' + stamp + '.html';
  }

  /* ── الإرسال اليدوي ─────────────────────────────────────────────────────
     على الجوال نستعمل Web Share API فتظهر تلكرام ضمن خيارات المشاركة ويصل
     الملف بنقرة. وإن لم تتوفر (سطح المكتب غالباً) ننزّل الملف ونفتح تلكرام
     حتى يسحبه المستخدم إلى المحادثة. */
  function canShareFile(file) {
    return !!(root.navigator && root.navigator.canShare && root.navigator.share &&
      root.navigator.canShare({ files: [file] }));
  }

  function share(built) {
    var file = new File([built.html], built.name, { type: 'text/html' });
    var title = '\u0634\u0631\u0643\u0629 \u0628\u0627\u0628\u0644 \u0644\u0644\u062a\u0648\u0638\u064a\u0641';
    var text = built.meta.mode === 'full'
      ? '\u0623\u0631\u0634\u064a\u0641 \u062e\u0627\u0635 \u0628\u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u2014 \u064a\u062d\u062a\u0648\u064a \u0628\u064a\u0627\u0646\u0627\u062a \u0634\u062e\u0635\u064a\u0629\u060c \u0644\u0627 \u064a\u064f\u062d\u0648\u0651\u0644.'
      : '\u0645\u0648\u0642\u0639 \u0634\u0631\u0643\u0629 \u0628\u0627\u0628\u0644 \u0644\u0644\u062a\u0648\u0638\u064a\u0641 \u2014 \u0627\u0636\u063a\u0637 \u0639\u0644\u0649 \u0627\u0644\u0645\u0644\u0641 \u0644\u062a\u0635\u0641\u0651\u062d \u0627\u0644\u0648\u0638\u0627\u0626\u0641 (\u064a\u0639\u0645\u0644 \u0628\u062f\u0648\u0646 \u0625\u0646\u062a\u0631\u0646\u062a).';

    if (canShareFile(file)) {
      return root.navigator.share({ files: [file], title: title, text: text })
        .then(function () { return 'shared'; })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          throw e;
        });
    }
    /* ⚠️ الاسم الحقيقي هو BRCUI لا UI (راجع نهاية ui.js). وكتابة الحارس
       `if (root.UI && …)` كانت تتخطّى التنزيل بصمت ثم تُبلّغ بالنجاح — أي
       يظنّ المستخدم أن الملف نزل ولا شيء ينزل. لا حارس صامت هنا: إن غابت
       الأداة نرمي خطأً صريحاً. */
    var U = root.BRCUI || root.UI;
    if (!U || !U.download) throw new Error('\u062a\u0639\u0630\u0651\u0631 \u062a\u0646\u0632\u064a\u0644 \u0627\u0644\u0645\u0644\u0641');
    U.download(built.name, built.html, 'text/html');
    return Promise.resolve('downloaded');
  }

  /* ── الإرسال التلقائي عبر بوت تلكرام ────────────────────────────────────
     ⚠️ التوكن يُحفظ في localStorage لهذا الجهاز فقط ولا يُكتب في الكود أبداً
     (الموقع ثابت بلا خادم — أي مفتاح في الكود يقرأه أي زائر من المصدر).
     يبقى من يفتح متصفح هذا الجهاز قادراً على قراءته، ولذلك نحذّر عند الحفظ. */
  var TG_KEY = 'brc-telegram-config';

  function getTelegram() {
    try { return JSON.parse(localStorage.getItem(TG_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function setTelegram(cfg) {
    try {
      if (!cfg) localStorage.removeItem(TG_KEY);
      else localStorage.setItem(TG_KEY, JSON.stringify(cfg));
      return true;
    } catch (e) { return false; }
  }

  function sendToTelegram(built, cfg) {
    cfg = cfg || getTelegram();
    if (!cfg || !cfg.token || !cfg.chatId) {
      return Promise.reject(new Error('\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u062a\u0644\u0643\u0631\u0627\u0645 \u063a\u064a\u0631 \u0645\u0643\u062a\u0645\u0644\u0629'));
    }
    var form = new FormData();
    form.append('chat_id', cfg.chatId);
    form.append('document', new File([built.html], built.name, { type: 'text/html' }));
    form.append('caption', built.meta.mode === 'full'
      ? '\u26a0\ufe0f \u0623\u0631\u0634\u064a\u0641 \u062e\u0627\u0635 \u0628\u0627\u0644\u0625\u062f\u0627\u0631\u0629 (\u0628\u064a\u0627\u0646\u0627\u062a \u0634\u062e\u0635\u064a\u0629) \u2014 ' + built.meta.createdAt.slice(0, 10)
      : '\u0645\u0648\u0642\u0639 \u0634\u0631\u0643\u0629 \u0628\u0627\u0628\u0644 \u0644\u0644\u062a\u0648\u0638\u064a\u0641 \u2014 ' + built.meta.createdAt.slice(0, 10) +
        '\n\u0627\u0636\u063a\u0637 \u0639\u0644\u0649 \u0627\u0644\u0645\u0644\u0641 \u0644\u062a\u0635\u0641\u0651\u062d \u0627\u0644\u0648\u0638\u0627\u0626\u0641 (\u064a\u0639\u0645\u0644 \u0628\u062f\u0648\u0646 \u0625\u0646\u062a\u0631\u0646\u062a).');

    return fetch('https://api.telegram.org/bot' + cfg.token + '/sendDocument', {
      method: 'POST', body: form
    }).then(function (res) { return res.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.description || '\u0631\u0641\u0636 \u062a\u0644\u0643\u0631\u0627\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644');
      return j;
    });
  }

  root.BRCArchive = {
    build: build,
    share: share,
    fileName: fileName,
    publicSnapshot: publicSnapshot,
    getTelegram: getTelegram,
    setTelegram: setTelegram,
    sendToTelegram: sendToTelegram,
    canShareFile: canShareFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
