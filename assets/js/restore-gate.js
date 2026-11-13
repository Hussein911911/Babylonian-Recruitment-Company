/* ===========================================================================
 *  HRC — بوابة المدير لصفحة الاسترجاع (restore.html)
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا هذا الملف؟
 *
 *  `restore.html` كانت **مفتوحة لأي زائر**: تُنزّل مخطط قاعدة البيانات كاملاً
 *  (٢٠٠ ك.ب من أسماء الجداول والدوال وسياسات RLS)، وتفتح أي ملف نسخة احتياطية
 *  `.hrcbak`. الصفحة نفسها تقول في واجهتها «استرجاع بصلاحية المدير فقط»
 *  وتربطها لوحة التحكم من قسم «حماية بيانات الشركة» — لكن التحقق لم يكن
 *  موجوداً إطلاقاً: صفر `session` وصفر `is_admin` في الصفحة.
 *
 *  ═══ لماذا لا نحذف المخطط من الصفحة بدل المصادقة؟ ═══
 *  حذفه كان الحل الأول الأبسط، لكنه يهدم شرطاً حقيقياً للمالك: الأداة يجب أن
 *  تعمل من `file://` بلا شبكة — أي بعد أن ينقطع الموقع أو يضيع المشروع، وهي
 *  اللحظة التي تُستخدم فيها فعلاً. و`fetch('docs/schema.sql')` يفشل هناك
 *  دائماً (CORS للملفات المحلية)، فلذلك يُضمَّن المخطط كنص.
 *
 *  فالحل: **نبقيه مضمّناً، ونطويه خلف جلسة مدير.** المستودع خاص أصلاً،
 *  والنص ليس سرّاً بذاته — لكن عرضه لكل زائر بلا سبب يكشف بنية نظام كاملة.
 *
 *  ═══ ثلاث حالات، ولكل حالة سلوك صريح ═══
 *
 *   ١) محلي (`file://`)   → تُفتح بلا قيود.
 *      هذه هي حالة الكوارث التي بُنيت الأداة لها. لا شبكة ⇒ لا استيثاق ممكن،
 *      والقيود تُعرقله. من يملك الملف يملك القاعدة أصلاً.
 *
 *   ٢) على الموقع + جلسة مدير → تُفتح كاملة، مع زر «تنزيل 1-schema.sql».
 *
 *   ٣) على الموقع + بلا جلسة (أو موظف لا مدير) → تُقفل.
 *      تبقى فقرةُ شرح، وتُخفى خطوات العمل الستة كلها — ومنها المخطط.
 *
 *  ═══ ⚠ ما لا تفعله هذه البوابة ═══
 *  إنها **ليست** حدّاً أمنياً للخادم: من يملك الرابط يستطيع قراءة HTML
 *  الخام قبل تنفيذ أي جافاسكربت. ولذلك لا يُعتمد عليها وحدها:
 *  `npm run embed-schema` يرفض التضمين إن لم تكن الصفحة تحمل البوابة
 *  (انظر الفحص في tools/embed-schema.mjs) — أو على الأقل يطبع تحذيراً صريحاً.
 *  الحدّ الحقيقي للأسرار يبقى في القاعدة: المفتاح المنشور لا يفتح جدولاً.
 *
 *  ═══ ما لا يُمَس ═══
 *  لا يتصل بأي قاعدة بيانات. الصفحة كلها تعمل في المتصفح، وفكّ التشفير
 *  محلي (AES-256-GCM + PBKDF2). البوابة تقرأ الجلسة فقط ثم تنسحب.
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;

  /* ---------- هل نحن على الموقع أم على ملف محلي؟ ---------- */
  function isLocal() {
    try {
      var p = root.location && root.location.protocol;
      /* file: هي الحالة المدعومة. أي شيء آخر (http/https) يعني «منشور». */
      return p === 'file:';
    } catch (e) { return true; }   /* بلا location: نعتبرها محلية (اختبار) */
  }

  /* ---------- عناصر الواجهة ---------- */
  function el(id) { return doc ? doc.getElementById(id) : null; }

  function setState(state, detail) {
    var gate = el('rp-gate');
    if (gate) gate.setAttribute('data-rp-gate-state', state);
    if (doc && doc.body) doc.body.setAttribute('data-rp-access', state);
    if (state === 'local') showNote('أنت تفتح الأداة محلياً من جهازك — كل شيء متاح.', 'ok');
    else if (state === 'admin') showNote('دخلت بصلاحية مدير — كل شيء متاح.', 'ok');
    else if (state === 'staff') showNote(detail || 'هذه الأداة للمدير فقط. حسابك موظف، فلا تُفتح له.', 'warn');
    else if (state === 'guest') showNote(detail || 'هذه الأداة للمدير فقط — سجّل الدخول من لوحة التحكم ثم أعد فتحها.', 'warn');
    else if (state === 'network') showNote(detail || 'تعذّر التحقق من جلستك (شبكة). أعد المحاولة.', 'warn');
  }

  function showNote(text, kind) {
    var n = el('rp-gate-note');
    if (!n) return;
    n.textContent = text;
    n.className = 'rp-gate-note is-' + (kind || 'warn');
    n.hidden = false;
  }

  /* ---------- خروج آمن للصفحة كلها ---------- */
  /* الحالة المقفلة: نُخفي كل الخطوات ونُظهر شرحاً. لا نعتمد على `hidden` وحده،
     فبعض المتصفحات القديمة تتجاهله على عناصر block — نضيف صنفاً أيضاً. */
  function lockEverything(reason) {
    if (!doc) return;
    var steps = doc.querySelectorAll('[data-rp-step]');
    for (var i = 0; i < steps.length; i++) {
      steps[i].hidden = true;
      steps[i].classList.add('is-locked');
    }
    var intro = el('rp-gate');
    if (intro) intro.hidden = false;
    setState('guest', reason);
    /* تنظيف أي مخطط سبق أن ظهر في الذاكرة (لو حقنه أحد قبل القفل) */
    try { root.__HRC_SCHEMA_SQL__ = ''; } catch (e) { /* لا شيء */ }
  }

  /* ---------- قراءة الجلسة والتحقق من الدور ---------- */
  /* نتحقق من الدور من `brc.staff` لا من التوكن: RLS تسمح للموظف بقراءة سطره
     هو (`staff_self_read`)، فالنتيجة سلطة القاعدة لا سلطة المتصفح. */
  function checkSession() {
    var cfg = root.HRCSupabaseConfig;
    if (!cfg || !cfg.url || !cfg.publishableKey || !root.supabase ||
        typeof root.supabase.createClient !== 'function') {
      return Promise.resolve({ state: 'network', detail: 'مكتبة الاتصال غير محمّلة — أعد فتح الصفحة من لوحة التحكم.' });
    }

    var client;
    try {
      client = root.supabase.createClient(cfg.url, cfg.publishableKey, {
        db: { schema: cfg.schema || 'brc' },
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'hrc-auth' }
      });
    } catch (e) {
      return Promise.resolve({ state: 'network', detail: 'تعذّر تهيئة الاتصال.' });
    }

    return client.auth.getSession().then(function (res) {
      var session = res && res.data ? res.data.session : null;
      if (!session || !session.user) return { state: 'guest' };
      return client.from('staff').select('role,active').eq('auth_id', session.user.id).limit(1)
        .then(function (r) {
          if (r && r.error) return { state: 'network', detail: 'تعذّر قراءة حسابك.' };
          var row = (r && r.data && r.data[0]) || null;
          if (!row) return { state: 'guest', detail: 'حسابك غير مرتبط بموظف — راجع المدير.' };
          if (row.active === false) return { state: 'guest', detail: 'حسابك موقوف — راجع المدير.' };
          if (row.role !== 'admin') return { state: 'staff' };
          return { state: 'admin' };
        });
    }).catch(function () {
      return { state: 'network', detail: 'تعذّر التحقق من جلستك (شبكة).' };
    });
  }

  /* ---------- فكّ المخطط — محلياً فقط ----------
     المخطط مضمّن في وسم `type="text/plain"` لا ينفّذه المتصفح، فالمتغيّر
     `window.__HRC_SCHEMA_SQL__` غير موجود في نافذة أي زائر. نفكّه هنا فقط
     عندما تكون الصفحة مفتوحة من الجهاز (file://) — وهي الحالة الوحيدة التي
     تحتاجه فيها: انقطاع الموقع أو ضياع المشروع. */
  function unsealSchema() {
    if (!doc) return '';
    try {
      var tag = doc.getElementById('hrc-schema-embed');
      if (!tag) return '';
      var sql = (tag.textContent || '').trim();
      if (!sql) return '';
      root.__HRC_SCHEMA_SQL__ = sql;
      return sql;
    } catch (e) { return ''; }
  }

  /* ---------- التشغيل ---------- */
  function boot() {
    if (!doc) return Promise.resolve({ state: 'no_dom' });

    /* محلي: نفتح كل شيء فوراً — هذا شرط الأداة. ونفكّ المخطط هنا وحده. */
    if (isLocal()) {
      var sql = unsealSchema();
      setState('local');
      if (!sql) showNote('المخطط غير مضمّن في هذه النسخة — نزّله من المستودع: docs/schema.sql', 'warn');
      return Promise.resolve({ state: 'local', schema: sql.length });
    }

    /* منشور: نقفل أولاً ثم نفتح إن ثبت أنه مدير.
       ⚠ الترتيب مقصود: القفل **قبل** انتظار الشبكة، كي لا تظهر الخطوات
       ولو لجزء من الثانية لمن ليس مديراً. */
    lockEverything('جارٍ التحقق من صلاحيتك…');
    var gate = el('rp-gate');
    if (gate) gate.hidden = false;

    return checkSession().then(function (r) {
      if (r.state === 'admin') {
        unlockAll();
        setState('admin');
        return r;
      }
      lockEverything(r.detail);
      return r;
    });
  }

  function unlockAll() {
    if (!doc) return;
    var steps = doc.querySelectorAll('[data-rp-step]');
    for (var i = 0; i < steps.length; i++) {
      steps[i].hidden = false;
      steps[i].classList.remove('is-locked');
    }
  }

  root.HRCRestoreGate = {
    boot: boot,
    isLocal: isLocal,
    /* للاختبار: نحقن عميلاً مزيفاً بدل الشبكة */
    _check: checkSession
  };
})(typeof window !== 'undefined' ? window : this);
