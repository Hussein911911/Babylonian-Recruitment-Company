/* ═══════════════════════════════════════════════════════════════════════════
   HRC — صفحة الاسترجاع المستقلّة
   ---------------------------------------------------------------------------
   لا اتصال بأي خدمة. كل ما يجري هنا داخل جهاز المستخدم:
     • قراءة الملف (FileReader)
     • فحص الغلاف بلا كلمة مرور
     • فك التشفير وتحقّق البصمة
     • تنزيل JSON / CSV
   ⛔ لا fetch ولا XMLHttpRequest ولا أي إرسال للخارج.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PB = window.HRCPortableBackup;
  var $ = function (id) { return document.getElementById(id); };
  var state = { envelope: null, payload: null, fileName: '' };

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'rp-status' + (kind ? ' is-' + kind : '');
  }

  /* أرقام لاتينية بفواصل الآلاف — نفس أسلوب لوحة الموقع (store.js).
     الأرقام الهندية (٠١٢) كانت تُلبس على القارئ: «٥» تُقرأ «٠» في الحجم الصغير. */
  function fmtNum(n) {
    return (typeof n === 'number' ? n : 0).toLocaleString('en-US');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ar-IQ', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return String(iso); }
  }

  function fmtBytes(n) {
    if (!n) return '—';
    if (n < 1024) return n + ' بايت';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' ك.ب';
    return (n / 1024 / 1024).toFixed(1) + ' م.ب';
  }

  function show(id) { var e = $(id); if (e) e.classList.remove('is-hidden'); }
  function hide(id) { var e = $(id); if (e) e.classList.add('is-hidden'); }

  /* ═══ ١) الملف ═══════════════════════════════════════════════════════════ */
  var drop = $('rp-drop'), fileInput = $('rp-file'), fileStatus = $('rp-file-status');

  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
  });

  function readFile(file) {
    state.envelope = null; state.payload = null; state.fileName = file.name;
    hide('rp-step2'); hide('rp-step3'); hide('rp-step4');
    setStatus(fileStatus, 'جارٍ قراءة الملف…');

    if (file.size > 200 * 1024 * 1024) {
      setStatus(fileStatus, 'الملف أكبر من الحد (٢٠٠ م.ب)', 'error'); return;
    }

    var reader = new FileReader();
    reader.onload = function () { handleText(String(reader.result || '')); };
    reader.onerror = function () { setStatus(fileStatus, 'تعذّرت قراءة الملف', 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  function handleText(text) {
    var info = PB.inspect(text);
    if (!info.ok) {
      setStatus(fileStatus, info.error + ' — تأكد أنك اخترت ملف النسخة الصحيح', 'error');
      return;
    }
    state.envelope = text;
    setStatus(fileStatus, 'ملف صالح: ' + state.fileName, 'ok');
    renderMeta(info);
    show('rp-step2'); show('rp-step3');
    $('rp-pass').value = '';
    $('rp-pass').focus();
    hide('rp-step4');
  }

  function renderMeta(info) {
    var rows = [
      ['اسم الملف', state.fileName],
      ['الصيغة', info.format],
      ['التشفير', info.cipher + ' · ' + info.kdf + ' · ' + fmtNum(info.iterations) + ' دورة'],
      ['تاريخ الإنشاء', fmtDate(info.sealedAt)],
      ['حجم البيانات', fmtBytes(info.bytes)]
    ];
    if (info.counts) {
      rows.push(['الوظائف', fmtNum(info.counts.jobs)]);
      rows.push(['البطاقات', fmtNum(info.counts.applicants)]);
      rows.push(['الفرص', fmtNum(info.counts.attempts)]);
      rows.push(['سجل التدقيق', fmtNum(info.counts.audit)]);
    }
    $('rp-meta').innerHTML = rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(String(r[1])) + '</dd></div>';
    }).join('');
  }

  /* ═══ ٣) فكّ التشفير ═════════════════════════════════════════════════════ */
  var unlockForm = $('rp-unlock'), unlockBtn = $('rp-unlock-btn'), unlockStatus = $('rp-unlock-status');

  $('rp-show').addEventListener('change', function () {
    $('rp-pass').type = this.checked ? 'text' : 'password';
  });

  unlockForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.envelope) { setStatus(unlockStatus, 'اختر الملف أولاً', 'error'); return; }
    var password = $('rp-pass').value;
    if (!password) { setStatus(unlockStatus, 'أدخل كلمة المرور', 'error'); return; }

    unlockBtn.disabled = true;
    setStatus(unlockStatus, 'جارٍ اشتقاق المفتاح وفكّ التشفير… قد يستغرق ثانية أو اثنتين');

    /* ═══ لا نُسقط محاولة المستخدم بسبب مسافة عابرة ══════════════════════════
       بلاغ المالك (2026-11-15): «أفكّ التشفير بنفس الرمز يقول خطأ».

       وأحد أسباب ذلك الواقعية: لوحة المفاتيح تُلحق مسافة سهواً، أو يستخدم
       النسخ من ملف نصّي فتأتي مسافة نهاية السطر. المسافة محرف كأي محرف.

       فنجرّب أولاً الكلمة كما كُتبت — لا نغيّر سلوك من كتبها بدقّة. ثم لو
       فشلت نجربها مقصوصة الطرفين، وإن نجحت **نُخبره صراحةً** أنه كان
       فاصلاً لا خطأً في الرمز، كي لا يظن أن الرمز تلف. */
    var cleaned = String(password).replace(/^[\s\u200B\u200E\u200F]+|[\s\u200B\u200E\u200F]+$/g, '');

    PB.open(state.envelope, password).catch(function (firstErr) {
      if (!cleaned || cleaned === password) throw firstErr;
      return PB.open(state.envelope, cleaned).then(function (r) {
        r.notes = (r.notes || []).concat(['طُبّق الرمز بعد إزالة مسافات زائدة من طرفيه']);
        setStatus(unlockStatus, 'نجح الفكّ — كان في طرفَي الرمز مسافة زائدة، وقد أُزيلت');
        return r;
      });
    }).then(function (res) {
      state.payload = res.payload;
      if (!res.notes) setStatus(unlockStatus, 'نجح الفكّ — البصمة مطابقة', 'ok');
      renderPayload(res);
      show('rp-step4');
      /* ٥) التفاصيل المرتبة — كل صف في كل جدول، مع بحث وتصدير CSV */
      if (window.HRCRestoreView) {
        window.HRCRestoreView.mount(state.payload);
        show('rp-step5');
        show('rp-step6');
      }
      $('rp-pass').value = '';
      /* التمرير تمريرُ راحةٍ لا وظيفة: لو غاب (بيئة اختبار أو متصفح قديم)
         فلا يجوز أن يُسقط فكّ التشفير الناجح. */
      var s4 = $('rp-step4');
      if (s4 && typeof s4.scrollIntoView === 'function') {
        s4.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }).catch(function (err) {
      setStatus(unlockStatus, err.message, 'error');
    }).then(function () {
      unlockBtn.disabled = false;
    });
  });

  /* ═══ ٤) المحتوى ═════════════════════════════════════════════════════════ */
  function renderPayload(res) {
    var p = res.payload || {}, c = p.counts || {};
    var items = [
      ['الوظائف', c.jobs != null ? c.jobs : (p.jobs || []).length],
      ['البطاقات', c.applicants != null ? c.applicants : (p.applicants || []).length],
      ['الفرص', c.attempts != null ? c.attempts : (p.job_attempts || []).length],
      ['سجل التدقيق', c.audit != null ? c.audit : (p.audit_log || []).length],
      ['أرقام مُصدرة', c.serials != null ? c.serials : (p.issued_serials || []).length],
      ['الحسابات', (p.staff || []).length]
    ];
    $('rp-totals').innerHTML = items.map(function (i) {
      return '<div class="rp-total"><b>' + fmtNum(i[1]) + '</b><span>' + esc(i[0]) + '</span></div>';
    }).join('');

    var sample = {
      exportedAt: p.exportedAt || null,
      schema: p.schema || null,
      firstJobs: (p.jobs || []).slice(0, 3),
      firstApplicants: (p.applicants || []).slice(0, 3).map(function (a) {
        return { serial: a.serial, full_name: a.full_name, phone: a.phone, status: a.status };
      })
    };
    /* ⚠️ عيّنة JSON كانت في <details> اختياري. حُذف الشرح من الصفحة، فصار
       العنصر غائباً — وكتابة `$('rp-preview').innerHTML` كانت **ترمي استثناءً
       يُسقط فكّ التشفير كله** بعد نجاحه، فلا تظهر الخطوات ٤-٦. القاعدة الآن:
       العرض الاختياري لا يُسقط الوظيفة الأساسية. */
    var preview = $('rp-preview');
    if (preview) preview.innerHTML = '<pre>' + esc(JSON.stringify(sample, null, 2)) + '</pre>';
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  $('rp-dl-json').addEventListener('click', function () {
    if (!state.payload) return;
    download('hrc-restored-' + stamp() + '.json',
      JSON.stringify(state.payload, null, 2), 'application/json;charset=utf-8');
  });

  $('rp-dl-csv').addEventListener('click', function () {
    if (!state.payload) return;
    var rows = state.payload.applicants || [];
    var cols = ['serial', 'full_name', 'phone', 'status', 'fee_paid', 'printed', 'created_at'];
    function cell(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var csv = [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (k) { return cell(r[k]); }).join(',');
    })).join('\r\n');
    download('hrc-cards-' + stamp() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  });

  /* ═══ تنزيل SQL جاهز للّصق في Supabase ═════════════════════════════════
     هذا ما طلبه المالك: «أبني موقعاً جديداً وأصعّد لهذه النسخة عليه».
     الملف يبدأ بـ TRUNCATE — للقواعد الجديدة فقط، والتحذير ظاهر في الصفحة. */
  /* ═══ تضمين صور الوظائف ═════════════════════════════════════════════════
     الصور المرتبطة بمشروع Supabase قد تختفي بحذف المشروع. ننزّلها مرة واحدة
     على الجهاز فيصير الملف مكتفياً بذاته. لا شيء يُرسل للخارج: التنزيل من
     نفس الروابط التي يعرضها الموقع للعامة. */
  var embedBtn = $('rp-embed-images'), embedStatus = $('rp-embed-status');

  function setEmbed(text, kind) {
    if (!embedStatus) return;
    embedStatus.textContent = text || '';
    embedStatus.className = 'rp-embed-status' + (kind ? ' is-' + kind : '');
  }

  if (embedBtn) embedBtn.addEventListener('click', function () {
    if (!state.payload || !window.HRCImageEmbed) return;
    var urls = window.HRCImageEmbed.collect(state.payload);
    if (!urls.length) {
      setEmbed('كل الصور روابط خارجية — لا شيء يُضمَّن.', 'ok');
      embedBtn.disabled = true;
      return;
    }
    if (!navigator.onLine) {
      setEmbed('لا اتصال — يُمكنك تنزيل SQL بالروابط، أو أعد المحاولة مع إنترنت.', 'error');
      return;
    }
    embedBtn.disabled = true;
    setEmbed('جارٍ تنزيل الصور… ٠ من ' + urls.length);

    window.HRCImageEmbed.embedAll(state.payload, {
      onProgress: function (done, total) {
        setEmbed('جارٍ تنزيل الصور… ' + done + ' من ' + total);
      }
    }).then(function (r) {
      state.payload.images = r.images;
      if (!r.embedded) {
        setEmbed('تعذّر تنزيل أي صورة (صلاحيات أو انقطاع). الملف يبقى صالحاً — الصور تبقى روابط.', 'error');
        embedBtn.disabled = false;
        return;
      }
      var size = 0;
      Object.keys(r.images).forEach(function (k) { size += r.images[k].length; });
      setEmbed(r.embedded + ' صورة مضمّنة داخل الملف (+' +
        Math.round(size / 1048576 * 10) / 10 + ' م.ب). نزّل SQL الآن.', 'ok');
      embedBtn.textContent = 'الصور مضمّنة ✓';
    }).catch(function (e) {
      setEmbed(e.message || 'تعذّر التنزيل', 'error');
      embedBtn.disabled = false;
    });
  });

  /* ═══ ملف الهيكل (1-schema.sql) ═════════════════════════════════════════
     ⚠ أمنياً: المخطط مضمّن داخل الصفحة، لا يُجلب بـfetch.

     السبب: `restore.html` يعمل من `file://` بلا شبكة — وهذا شرط المالك
     («أفتحها بعد انقطاع الموقع»). أي `fetch('docs/schema.sql')` يفشل هناك
     بسبب سياسة CORS للملفات المحلية.

     ولماذا ليس خطراً أن يكون المخطط في الصفحة؟
       • المخطط ليس سراً: هو نفسه منشور في مستودع عام أصلاً.
       • يحتوي صفر مفاتيح — المفتاح الحقيقي `app.brc_secret` يُضبط يدوياً
         في القاعدة، والمخطط يرفض العمل بدونه (يرفع استثناءً).
       • لا يمنح وصولاً: الصلاحيات (RLS + revoke) تُنشأ *بواسطته*، فوجود
         نصّه لا يفتح شيئاً على قاعدة قائمة.
     ما يجب ألا يكون هنا أبداً: مفتاح anon/service_role، أو أي بيانات عملاء. */
  /* ⚠️ لا نقرأ المتغيّر مرة واحدة عند التحميل: البوابة تفكّ المخطط **بعد**
     التحقق (محلياً فقط)، وقيمةٌ مأخوذة الآن تبقى فارغة للأبد. نقرأها لحظة
     الضغط على الزر. */
  /* مصدر مخطط القاعدة في هذه الصفحة هو **الوسم المضمّن** لا متغيّر عام:
     `restore-gate.js` يفكّ الوسم ويكتب النص في `__HRC_SCHEMA_SQL__` **فقط**
     عند فتح الصفحة محلياً أو بجلسة مدير. إن لم يفكّه أحد (أو نُفّذت الصفحة
     بلا البوابة) فالمتغيّر غائب — فنقرأ الوسم مباشرة كي لا يصير الزر ميتاً.
     ⚠️ لا نعرّفه كمتغيّر عام: فحص restore-gate يمنع ذلك، وهو محقّ. */
  /* ⚠️ الوسم يحمل المخطط **مُرمَّزاً بـJSON** (JSON.stringify في أداة البناء)،
     لأن HTML لا يسمح بـ`</script>` داخل سكربت. و`restore-gate.js` ينسخ
     `textContent` كما هو إلى المتغيّر — أي النصّ المرمّز لا المخطط.
     فتقسيمه وهو مرمّز يعطي جزءاً واحداً: كل `\n` حرفان، وكل `\"` يُدخل
     قارئَنا في حالة نصّ فلا يجد نهاية جملة. فيصل للمالك ملف واحد مشوّه.

     فالفكّ هنا، ومن المصدرين كليهما. */
  function unseal(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    if (text.charAt(0) === '"') {
      try { return JSON.parse(text); } catch (e) { /* ليس JSON — نُكمِل */ }
    }
    return text;
  }

  function schemaSql() {
    var fromVar = unseal(window.__HRC_SCHEMA_SQL__);
    if (fromVar) return fromVar;
    var embed = document.getElementById('hrc-schema-embed');
    if (!embed) return '';
    return unseal(embed.textContent);
  }

  /* ═══ تنزيل الهيكل — أجزاء لا ملفاً واحداً ═══════════════════════════════
     ⚠️ عطل حقيقي أُصلح 2026-11-15:

     كان الزر ينزّل `1-schema.sql` = ٣١٥٤ سطراً في ملف واحد. ومحرّر Supabase
     يقصّ اللصق عند ~٢٠٠٠ سطر **ويرفع Success** رغم النقص. فيخرج المالك من
     صفحة الاسترجاع بملف يفكّ تشفيره وينسخه، ثم يبني قاعدة ناقصة ١١ جدولاً
     من ١٩ — والخطأ لا يظهر إلا عند أول بطاقة تُطبع.

     فصار الزر يقسّم المخطط المضمّن في المتصفح إلى خمسة أجزاء تحت ٧٠٠ سطر،
     كلها قابلة للصق. لا شبكة ولا Node — التقسيم يعمل من `file://` أيضاً.

     القاعدة: نفس محرّك `tools/sql-split-core.mjs` المستعمل عند البناء،
     منسوخ هنا لأن الصفحة تعمل بلا حزمة بناء ولا وحدة ES. */
  function splitSchema(text) {
    var LIMIT = 690, LIMIT_BYTES = 180000;
    var stmts = [], i = 0, n = text.length, start = 0;
    var inS = false, inD = false, inLC = false, inBC = false, tag = null;
    while (i < n) {
      var c = text.charAt(i), two = text.substr(i, 2);
      if (inLC) { if (c === '\n') inLC = false; i++; continue; }
      if (inBC) { if (two === '*/') { inBC = false; i += 2; continue; } i++; continue; }
      if (inS) {
        if (c === "'") { if (text.charAt(i + 1) === "'") { i += 2; continue; } inS = false; }
        i++; continue;
      }
      if (inD) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { i += 2; continue; } inD = false; }
        i++; continue;
      }
      if (tag) { if (text.substr(i, tag.length) === tag) { i += tag.length; tag = null; continue; } i++; continue; }
      if (two === '--') { inLC = true; i += 2; continue; }
      if (two === '/*') { inBC = true; i += 2; continue; }
      if (c === "'") { inS = true; i++; continue; }
      if (c === '"') { inD = true; i++; continue; }
      if (c === '$') {
        var m = /^(?:\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(text.slice(i));
        if (m) { tag = m[0]; i += m[0].length; continue; }
        i++; continue;
      }
      if (c === ';') { stmts.push(text.slice(start, i + 1)); start = i + 1; i++; continue; }
      i++;
    }
    var rest = text.slice(start);
    if (rest.trim()) stmts.push(rest);

    function lines(s) { return (s.match(/\n/g) || []).length; }
    var parts = [], cur = '', curL = 0;
    for (var k = 0; k < stmts.length; k++) {
      var st = stmts[k], l = lines(st);
      /* الجملة الواحدة الأكبر من السقف تُترك وحدها — لا تُقطَع */
      if (curL > 0 && (curL + l > LIMIT || cur.length + st.length > LIMIT_BYTES)) {
        parts.push(cur); cur = ''; curL = 0;
      }
      cur += st; curL += l;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  var schemaBtn = $('rp-dl-schema');
  if (schemaBtn) schemaBtn.addEventListener('click', function () {
    var SCHEMA_SQL = schemaSql();
    if (!SCHEMA_SQL) {
      setStatus(unlockStatus, 'ملف الهيكل غير مضمّن في هذه الصفحة — نزّله من المستودع: docs/schema.sql', 'error');
      return;
    }
    var parts = splitSchema(SCHEMA_SQL);
    var total = parts.length;
    var pad = function (x) { return String(x).padStart(2, '0'); };

    /* ⚠️ لماذا أزرار منفصلة لا خمسة تنزيلات بضغطة؟
       جرّبناها: المتصفح **يحجب** التنزيلات المتعددة التلقائية، فيصل ملف
       واحد فقط ويظنّ المالك أن الباقي نزل. زر لكل جزء = سلوك متوقّع بلا
       حجب، ويعرف المالك بالضبط أي جزء نزّل وأي جزء لصق. */
    function partText(idx) {
      return '--  HRC — هيكل قاعدة البيانات · الجزء ' + pad(idx + 1) + ' من ' + pad(total) + '\n' +
        '--  ---------------------------------------------------------------------------\n' +
        '--  ⚠ الصق الأجزاء بالترتيب: واحداً بعد الآخر، كل واحد في استعلام جديد.\n' +
        '--  ⚠ لا تلصق جزءاً قبل نجاح الذي قبله — والملف كامل لا يدخل في لصقة واحدة\n' +
        '--     في لصقة واحدة (محرّر Supabase يقصّ عند ~٢٠٠٠ سطر ويرفع Success).\n' +
        '--  ⚠ قبل البدء: فعّل pgcrypto و pg_cron من Database → Extensions.\n' +
        '--  ---------------------------------------------------------------------------\n\n';
    }

    /* ⚠️ رقم الأجزاء يُبنى من العدد الفعلي لا يُكتب في الزر. كان الزر يقول
       «(٥)» بينما المخطط صار ستة أجزاء بعد إضافة كتلة 2026-11-17 — ونصٌّ
       يكذب أسوأ من غياب النص. */
    var label = $('rp-dl-schema');
    if (label) label.textContent = 'عرض أجزاء الهيكل (' + total + ')';

    var box = $('rp-schema-parts');
    if (!box) return;
    /* إن كانت الأزرار مبنية سابقاً لا نعيد بناءها */
    if (box.querySelector('button')) { box.hidden = false; return; }
    box.replaceChildren();
    parts.forEach(function (body, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rp-btn rp-btn-gold';
      b.textContent = 'تنزيل الجزء ' + (idx + 1) + ' من ' + total;
      b.addEventListener('click', function () {
        window.HRCRestoreView.download('1-schema-part-' + pad(idx + 1) + '.sql',
          partText(idx) + body, 'application/sql;charset=utf-8');
        b.textContent = '✓ الجزء ' + (idx + 1) + ' نُزّل';
        b.classList.remove('rp-btn-gold');
        b.classList.add('rp-btn');
        setStatus(unlockStatus, 'نُزّل الجزء ' + (idx + 1) + ' — الصقه في SQL Editor ثم عُد للجزء ' + (idx + 2), 'ok');
      });
      box.appendChild(b);
    });
    box.hidden = false;
    setStatus(unlockStatus, 'الهيكل ' + total + ' أجزاء — نزّلها بالترتيب والصق كل واحد في استعلام جديد', 'ok');
  });

  var sqlBtn = $('rp-dl-sql');
  if (sqlBtn) sqlBtn.addEventListener('click', function () {
    if (!state.payload || !window.HRCRestoreSql) return;
    var sql = window.HRCRestoreSql.buildSql(state.payload);
    window.HRCRestoreView.download('2-data-' + window.HRCRestoreView.stamp() + '.sql',
      sql, 'application/sql;charset=utf-8');
    setStatus(unlockStatus, 'نُزّل 2-data.sql — شغّله بعد 1-schema.sql على قاعدة جديدة', 'ok');
  });

  /* ═══ ملف واحد كامل: الهيكل + البيانات ═══
     طلب المالك (2026-11-17). يستعمل نفس المولّد الذي تستعمله الأداة
     (assets/js/full-dump.js + restore-sql.js) — فلا منطقان ينحرفان.

     ⚠️ لا نُقسّمه ولا نُعدّه للّصق: هو مبنيّ ليُنفَّذ بأداة. لو قسّمناه
     لصار نسخة ثانية من الأجزاء الخمسة، وهذا عكس ما طلبه. */
  var fullBtn = $('rp-dl-full');
  if (fullBtn) fullBtn.addEventListener('click', function () {
    if (!state.payload) return;
    if (!window.HRCFullDump) {
      setStatus(unlockStatus, 'مولّد الملف الكامل غير محمّل — حدّث الصفحة', 'error');
      return;
    }
    var sql;
    try {
      sql = window.HRCFullDump.build({ schema: schemaSql(), payload: state.payload });
    } catch (e) {
      setStatus(unlockStatus, 'تعذّر بناء الملف الكامل: ' + (e.message || e), 'error');
      return;
    }
    var sum = window.HRCFullDump.SUMMARY(state.payload);
    /* فحص أمان قبل التنزيل: ملف بلا بطاقات هو أسوأ من لا ملف — يُنفَّذ
       بنجاح ويترك القاعدة فارغة. فنمنع تنزيله بدل أن نثق. */
    if (!sum.counts.applicants) {
      setStatus(unlockStatus,
        'النسخة لا تحتوي أي بطاقة — لن يكون هذا ملفاً مفيداً. أوقفتُ التنزيل.', 'error');
      return;
    }
    window.HRCRestoreView.download('HRC-FULL-' + window.HRCRestoreView.stamp() + '.sql',
      sql, 'application/sql;charset=utf-8');
    setStatus(unlockStatus,
      'نُزّل الملف الكامل: ' + sum.counts.applicants + ' بطاقة · ' +
      sum.counts.jobs + ' وظيفة · ' + sum.counts.job_attempts + ' محاولة · ' +
      sum.counts.audit_log + ' سجل. لا تلصقه — أعطه للأداة تنفّذه كاملاً.', 'ok');
  });

  var allCsvBtn = $('rp-dl-all-csv');
  if (allCsvBtn) allCsvBtn.addEventListener('click', function () {
    if (!state.payload || !window.HRCRestoreView) return;
    window.HRCRestoreView.exportAll();
  });

  $('rp-lock').addEventListener('click', function () {
    state.payload = null; state.envelope = null; state.fileName = '';
    $('rp-pass').value = '';
    ['rp-preview','rp-totals','rp-meta'].forEach(function (id) { var e = $(id); if (e) e.innerHTML = ''; });
    /* تفريغ العرض المرتّب — لا يبقى أي صف في الذاكرة */
    if (window.HRCRestoreView) window.HRCRestoreView.unmount();
    /* ⚠ كانت ٥ و٦ تُنسيان: تُمسح الجداول وتبقى ظاهرة أعين المستخدم —
       يظنّ أن البيانات لم تُحذف. الآن تُخفى كل الخطوات معاً. */
    ['rp-step2', 'rp-step3', 'rp-step4', 'rp-step5', 'rp-step6'].forEach(hide);
    fileInput.value = '';
    setStatus(fileStatus, 'أُفرغت الذاكرة — الملف والبيانات لم يبقَ منها شيء في هذه الصفحة', 'ok');
    setStatus(unlockStatus, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function stamp() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ═══ مؤشر الاتصال — للتذكير أنها لا تحتاج شبكة ═════════════════════════ */
  function netState() {
    var el = $('rp-net');
    if (!el) return;
    el.textContent = navigator.onLine ? 'أداة مستقلّة — تعمل بلا إنترنت' : 'بلا إنترنت — تعمل طبيعياً';
    el.classList.toggle('is-offline', !navigator.onLine);
  }
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  netState();

  if (!PB || !PB.available()) {
    setStatus(fileStatus,
      'هذا المتصفح لا يوفّر Web Crypto — افتح الصفحة عبر HTTPS أو من localhost', 'error');
  }

  /* ═══ بوابة المدير (2026-11-13) ═══════════════════════════════════════════
     الصفحة منشورة على الموقع، وخطواتها تكشف مخطط القاعدة وتفتح أي نسخة
     احتياطية. البوابة تقفلها ما لم تكن الجلسة جلسة مدير، وتتركها مفتوحة على
     file:// (شرط عملها عند انقطاع الموقع). ⚠️ نُشغّلها في النهاية كي لا
     يحجب `return` مبكر بقية التهيئة؛ القفل نفسه يقع فوراً عند التحميل. */
  if (window.HRCRestoreGate && typeof window.HRCRestoreGate.boot === 'function') {
    window.HRCRestoreGate.boot();
    var retry = $('rp-gate-retry');
    if (retry) retry.addEventListener('click', function () {
      retry.disabled = true;
      var old = retry.textContent;
      retry.textContent = 'جارٍ الفحص…';
      Promise.resolve(window.HRCRestoreGate.boot()).catch(function () {}).then(function () {
        retry.disabled = false;
        retry.textContent = old;
      });
    });
  }
})();
