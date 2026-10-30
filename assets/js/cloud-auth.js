/* ===========================================================================
 *  HRC — الدخول عبر Supabase Auth (HRCCloudAuth)
 *  ---------------------------------------------------------------------------
 *  المشكلة: النظام المحلي يدخل بـ username + كلمة مرور مخزّنة في config.js
 *  (مكشوفة للجميع). Supabase Auth يعمل بالبريد الإلكتروني.
 *
 *  الحل: mapping شفّاف بلا أي كشف بيانات:
 *    • إن أدخل الموظف بريداً كاملاً (فيه @) → يُستخدم كما هو
 *    • وإلا → username@<النطاق المضبوط>   (مثال: admin → admin@hrc-babil.com)
 *  هكذا تبقى واجهة الدخول كما هي (حقل «اسم المستخدم») بلا أي تغيير،
 *  ولا نحتاج دالة عامة تكشف بريد موظف — وهو ما كان سيسرّب البيانات.
 *
 *  الأدوار: تُقرأ من جدول brc.staff عبر auth_id. من ليس له سطر هناك لا يستطيع
 *  فعل أي شيء (كل دوال الصلاحية في القاعدة تُقرأ من نفس الجدول)، وRLS تمنح
 *  الموظف قراءة سطره هو فقط.
 *
 *  كل الدوال غير متزامنة. الاختبار بعميل وهمي: tests/cloud-auth.mjs
 * =========================================================================== */
(function (root) {
  'use strict';

  function cfg() {
    var c = root.HRCSupabaseConfig || {};
    return {
      /* نطاق البريد المُشتقّ من اسم المستخدم — يجب أن يطابق ما أُنشئت به
         حسابات Auth في Supabase. إن تركه فارغاً فلن يُقبل إلا بريد كامل. */
      domain: c.authEmailDomain || 'hrc-babil.com',
      /* السكيما التي تعيش فيها جداول الشركة (brc) — تُعلَن في ترويسة PostgREST */
      schema: c.schema || 'brc',
      url: String(c.url || '').replace(/\/+$/, '')
    };
  }

  /* fetch بأولوية الجذر (window.fetch) كما في بقية الملفات: يسمح بالاختبار
     بحقن fetch وهمي، ويسقط إلى العام إن لم يكن الجذر يوفّره. */
  function doFetch(url, init) {
    var f = root.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (typeof f !== 'function') return Promise.reject(new Error('fetch غير متاح في هذه البيئة'));
    return f(url, init);
  }

  /* قراءة رد HTTP كـ JSON بلا انهيار على رد فارغ أو غير JSON */
  function readJson(res) {
    if (!res || typeof res.text !== 'function') return Promise.resolve(null);
    return res.text().then(function (t) {
      if (!t) return null;
      try { return JSON.parse(t); } catch (e) { return { message: String(t).slice(0, 300) }; }
    }).catch(function () { return null; });
  }

  /* اسم المستخدم → البريد. القاعدة الوحيدة الموثوقة، ونختبرها في اختبارات. */
  function toEmail(usernameOrEmail, domainOverride) {
    var v = String(usernameOrEmail == null ? '' : usernameOrEmail).trim();
    if (!v) return '';
    if (v.indexOf('@') >= 0) return v.toLowerCase();
    var d = domainOverride || cfg().domain;
    if (!d) return '';
    return (v + '@' + d).toLowerCase();
  }

  /* واجهة الدخول تُعلن «اسم مستخدم» — نتحقق أن الإدخال مفهوم قبل إرساله */
  function looksUsable(usernameOrEmail) {
    var v = String(usernameOrEmail == null ? '' : usernameOrEmail).trim();
    if (!v) return false;
    if (v.indexOf('@') >= 0) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    return /^[A-Za-z0-9._-]{2,}$/.test(v);
  }

  function create(client) {
    if (!client || !client.auth) throw new Error('HRCCloudAuth: عميل سوبابيس مطلوب');

    /* ------------------------------ الدخول ------------------------------ */
    function login(usernameOrEmail, password, onAuthenticated) {
      if (!looksUsable(usernameOrEmail)) {
        return Promise.resolve({ ok: false, code: 'bad_input', error: 'اسم المستخدم غير صالح' });
      }
      if (!password) {
        return Promise.resolve({ ok: false, code: 'bad_input', error: 'كلمة المرور مطلوبة' });
      }
      var email = toEmail(usernameOrEmail);
      if (!email) {
        return Promise.resolve({ ok: false, code: 'no_email', error: 'تعذّر اشتقاق البريد — أدخل بريداً كاملاً' });
      }

      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res && res.error) {
            /* رسائل مفهومة بدل نصوص سوبابيس الإنجليزية */
            var msg = String(res.error.message || '');
            var code = 'auth_failed';
            if (/invalid login credentials/i.test(msg)) { code = 'bad_credentials'; msg = 'اسم المستخدم أو كلمة المرور غير صحيحة'; }
            else if (/email not confirmed/i.test(msg)) { code = 'unconfirmed'; msg = 'الحساب غير مُفعَّل — راجع بريد التفعيل'; }
            else if (/rate limit|too many/i.test(msg)) { code = 'rate_limited'; msg = 'محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة'; }
            return { ok: false, code: code, error: msg, raw: res.error };
          }
          if (!res || !res.data || !res.data.user) {
            return { ok: false, code: 'no_user', error: 'لم يُرجِع الخادم بيانات مستخدم' };
          }
          // The password is verified, so permitted read-only queries can start in
          // parallel with staff-profile verification. Never expose them to the UI
          // until that verification has also succeeded.
          if (typeof onAuthenticated === 'function') {
            try { onAuthenticated(res.data.user); } catch (_) { /* profile check remains authoritative */ }
          }
          return loadProfile(client, res.data.user).then(function (prof) {
            if (!prof) {
              return {
                ok: false, code: 'no_staff_row',
                error: 'الحساب موجود لكن غير مرتبط بموظف — أضف سطراً في brc.staff',
                user: res.data.user
              };
            }
            if (prof.active === false) {
              return { ok: false, code: 'inactive', error: 'الحساب موقوف — راجع المدير' };
            }
            return { ok: true, user: res.data.user, session: res.data.session || null, profile: prof };
          });
        })
        .catch(function (e) {
          return { ok: false, code: 'network', error: 'تعذّر الاتصال بالخدمة: ' + (e && e.message || e) };
        });
    }

    /* --------------------- قراءة ملف الموظف من brc.staff ---------------------
     *  RLS تسمح للموظف بقراءة سطره هو (staff_self_read). لو لم يوجد سطر
     *  فالنتيجة فارغة — وهذا يعني حساب Auth بلا صلاحيات، وهو ما نُبلّغ عنه. */
    function loadProfile(client, user) {
      if (!user) return Promise.resolve(null);
      return client.from('staff').select('*').eq('auth_id', user.id).limit(1)
        .then(function (res) {
          if (res && res.error) return null;
          var rows = (res && res.data) || [];
          if (!rows.length) return null;
          var r = rows[0];
          return {
            id: r.id,
            username: r.username,
            name: r.full_name,
            role: r.role === 'admin' ? 'admin' : 'staff',
            title: r.job_title || '',
            phone: r.phone || '',
            active: r.active !== false,
            authId: r.auth_id
          };
        })
        .catch(function () { return null; });
    }

    /* ------------------------- استعادة الجلسة عند الإقلاع ------------------------- */
    /* استعادة الجلسة: تُرجع الجلسة **فور** قراءتها من التخزين، والملف الشخصي
       (سطر brc.staff) يُطلب على حدة عبر profileFor — كي يبدأ جلب البيانات
       بالتوازي معه بدل انتظاره (رحلة كاملة أقل عند كل فتح للوحة). */
    function sessionOnly() {
      return client.auth.getSession()
        .then(function (res) {
          var session = res && res.data ? res.data.session : null;
          if (!session || !session.user) return { ok: false, code: 'no_session' };
          return { ok: true, user: session.user, session: session };
        })
        .catch(function (e) { return { ok: false, code: 'network', error: String(e && e.message || e) }; });
    }

    function profileFor(session) {
      if (!session || !session.user) return Promise.resolve({ ok: false, code: 'no_session' });
      return loadProfile(client, session.user).then(function (prof) {
        if (!prof) return { ok: false, code: 'no_staff_row', user: session.user };
        if (prof.active === false) return { ok: false, code: 'inactive' };
        return { ok: true, user: session.user, session: session, profile: prof };
      }).catch(function (e) { return { ok: false, code: 'network', error: String(e && e.message || e) }; });
    }

    function restore() {
      return sessionOnly().then(function (r) {
        if (!r.ok) return r;
        return profileFor(r.session);
      });
    }

    /* -------------------------------- الخروج -------------------------------- */
    function logout() {
      return client.auth.signOut()
        .then(function (res) {
          if (res && res.error) return { ok: false, error: res.error.message };
          return { ok: true };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    }

    /* --------------------------- تغيير كلمة المرور --------------------------- */
    function changePassword(newPassword) {
      return client.auth.updateUser({ password: newPassword })
        .then(function (res) {
          if (res && res.error) return { ok: false, error: res.error.message };
          return { ok: true };
        })
        .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    }

    /* ==========================================================================
     *  إدارة حسابات الموظفين (Auth + brc.staff) — للمدير من الإعدادات
     *  --------------------------------------------------------------------------
     *  ⚠️ علّتان حقيقيتان كشفهما tests/staff-accounts.mjs، وكلتاهما تُنتج أسوأ من
     *     مجرد «فشل إنشاء»: مستخدم Auth يُنشأ فعلاً ثم يفشل ربطه بموظف، فلا يدخل
     *     صاحبه أبداً («الحساب موجود لكن غير مرتبط بموظف») ولا تُصلحه إعادة
     *     المحاولة لأن Auth يرفض البريد المكرر:
     *
     *   1) كان سطر brc.staff يُدرج بعميل الواجهة (المفتاح العام)، وسياسة RLS عليه
     *      (staff_admin_write) تشترط brc.is_admin() أي **جلسة مدير مُصادَقة**.
     *      والمدير في الوضع الانتقالي داخل بكلمة مرور محلية بلا أي جلسة سحابية →
     *      كل إدراج يُرفض بـ 42501 permission denied — رغم أن الإنشاء «نجح» في Auth.
     *
     *   2) لم يكن في المسار أي تكرار آمن: حساب نصف جاهز يُغلق على صاحبه للأبد.
     *
     *  الحل: كتابة brc.staff تمرّ بمفتاح الخدمة نفسه اللازم لإنشاء Auth (عبر
     *  PostgREST على سكيما brc) فتتجاوز RLS بلا حاجة إلى جلسة سحابية؛ والإنشاء
     *  **متكرر بلا ضرر**: إن كان مستخدم Auth موجوداً نُكمل به ونربطه بدل رفض الطلب،
     *  فتُصلَح الحسابات المعطوبة بمحاولة واحدة من المدير.
     *
     *  ⚠️ مفتاح الخدمة سرّي: لا يُحفظ هنا ولا يُسجَّل ولا يُرسَل إلى أي جهة غير
     *     مشروع الشركة — يُستعمل في الترويسة لحظة النداء ثم يُنسى.
     * ======================================================================== */

    function baseUrl() {
      return String(client.supabaseUrl || cfg().url || '').replace(/\/+$/, '');
    }

    function svcHeaders(key, method) {
      var m = String(method || 'GET').toUpperCase();
      var h = { apikey: key, Authorization: 'Bearer ' + key };
      /* سكيما brc تُعلَن في الترويسة: القراءة بـ Accept-Profile والكتابة
         بـ Content-Profile — نفس ما تفعله postgrest-js. بلا هذا يبحث PostgREST
         في public فيرد PGRST205 «جدول غير موجود» وهو أشهر خطأ إعداد. */
      if (m === 'GET' || m === 'HEAD') h['Accept-Profile'] = cfg().schema;
      else h['Content-Profile'] = cfg().schema;
      return h;
    }

    function errText(res, fallback) {
      var b = res && res.body;
      var m = b && (b.message || b.details || b.hint || b.error_description || b.error || b.msg);
      return String(m || (res && res.error) || fallback || 'خطأ غير معروف');
    }

    function firstRow(body) {
      if (Array.isArray(body)) return body[0] || null;
      return (body && typeof body === 'object') ? body : null;
    }

    /* ---- brc.staff بمفتاح الخدمة (يتجاوز RLS عمداً — ولهذا هو سرّي) ---- */
    function staffRest(key, query, opts) {
      opts = opts || {};
      var base = baseUrl();
      if (!base) return Promise.resolve({ ok: false, status: 0, error: 'رابط Supabase غير مُعرّف' });
      var method = opts.method || 'GET';
      var init = { method: method, headers: svcHeaders(key, method) };
      if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
      if (opts.prefer) init.headers['Prefer'] = opts.prefer;
      return doFetch(base + '/rest/v1/staff' + (query || ''), init)
        .then(function (res) { return readJson(res).then(function (b) { return { ok: res.ok, status: res.status, body: b }; }); })
        .catch(function (e) { return { ok: false, status: 0, error: 'تعذّر الوصول إلى قاعدة الشركة: ' + (e && e.message || e) }; });
    }

    /* ---- GoTrue Admin (إنشاء/قراءة/تعديل/حذف مستخدمي Auth) ---- */
    function adminApi(key, method, path, body) {
      var base = baseUrl();
      if (!base) return Promise.resolve({ ok: false, status: 0, error: 'رابط Supabase غير مُعرّف' });
      var init = { method: method, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
      if (body) init.body = JSON.stringify(body);
      return doFetch(base + path, init)
        .then(function (res) { return readJson(res).then(function (b) { return { ok: res.ok, status: res.status, body: b }; }); })
        .catch(function (e) { return { ok: false, status: 0, error: 'تعذّر الوصول إلى خدمة الحسابات: ' + (e && e.message || e) }; });
    }

    /* البحث عن مستخدم Auth بالبريد (صفحة بصفحة، بحدّ أعلى يمنع حلقة لا نهائية) */
    function findAuthUser(key, email) {
      function page(n) {
        return adminApi(key, 'GET', '/auth/v1/admin/users?page=' + n + '&per_page=200').then(function (res) {
          if (!res.ok) return { error: errText(res, 'تعذّر قراءة مستخدمي Auth — تحقق من مفتاح الخدمة') };
          var list = (res.body && (res.body.users || res.body)) || [];
          if (!Array.isArray(list)) return { error: 'رد غير مفهوم من خدمة الحسابات' };
          var hit = list.filter(function (u) { return u && String(u.email || '').toLowerCase() === email; })[0];
          if (hit) return { user: hit };
          if (list.length < 200 || n >= 25) return { user: null };
          return page(n + 1);
        });
      }
      return page(1);
    }

    function setAuthPassword(key, authId, password) {
      return adminApi(key, 'PUT', '/auth/v1/admin/users/' + encodeURIComponent(authId), { password: password });
    }

    /* إنشاء مستخدم Auth أو العثور على الموجود (تكرار آمن + إصلاح حساب نصف جاهز) */
    function ensureAuthUser(key, email, password, name, username) {
      return adminApi(key, 'POST', '/auth/v1/admin/users', {
        email: email, password: password, email_confirm: true,
        user_metadata: { full_name: name, username: username }
      }).then(function (res) {
        var b = res.body || {};
        var authId = b.id || (b.user && b.user.id);
        if (res.ok && authId) return { ok: true, authId: authId, existed: false };

        var msg = String(b.msg || b.error_description || b.error || b.message || '');
        if (res.status === 422 || res.status === 409 || /already|exist|registered/i.test(msg)) {
          /* الحساب موجود مسبقاً: إمّا محاولة سابقة فشلت بعد هذه الخطوة، أو حساب
             أُنشئ يدوياً. نُكمل به بدل الرفض — وهذا هو مسار الإصلاح الذاتي. */
          return findAuthUser(key, email).then(function (f) {
            if (f.error) return { ok: false, code: 'auth_lookup', error: f.error, partial: true };
            if (!f.user) {
              return { ok: false, code: 'auth_orphan', partial: true,
                error: 'البريد مسجّل في Auth لكن تعذّر العثور على مستخدمه — راجع مستخدمي المشروع في Supabase' };
            }
            /* كلمة المرور تُحدَّث إلى ما أعطاه المدير: وعدُ «هذه كلمة مرورك»
               يجب أن يكون صحيحاً، وإلا بقي الموظف حائراً بلا دخول. */
            return setAuthPassword(key, f.user.id, password).then(function (pr) {
              return { ok: true, authId: f.user.id, existed: true, passwordReset: pr.ok === true };
            });
          });
        }
        return { ok: false, code: 'auth_failed', error: 'خطأ من خدمة الحسابات: ' + (msg || ('HTTP ' + res.status)) };
      });
    }

    function staffRowOf(data) {
      return {
        username: String(data.username == null ? '' : data.username).trim(),
        full_name: String(data.name == null ? '' : data.name).trim(),
        role: data.role === 'admin' ? 'admin' : 'staff',
        job_title: String(data.title == null ? '' : data.title).trim(),
        phone: String(data.phone == null ? '' : data.phone).trim(),
        active: data.active !== false
      };
    }

    function patchStaffRow(key, id, row, wasRepair) {
      return staffRest(key, '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: row, prefer: 'return=representation' })
        .then(function (res) {
          if (!res.ok) return { ok: false, error: 'تعذّر تحديث سطر الموظف: ' + errText(res, 'تحقق من سكيما brc ومفتاح الخدمة') };
          return { ok: true, row: firstRow(res.body), repaired: !!wasRepair };
        });
    }

    /* ربط مستخدم Auth بسطر brc.staff — إدراج إن لم يوجد، وتعديل إن وُجد */
    function linkStaffRow(key, authId, data) {
      var row = staffRowOf(data);
      return staffRest(key, '?auth_id=eq.' + encodeURIComponent(authId) + '&select=id,username,auth_id').then(function (found) {
        if (!found.ok) return { ok: false, error: 'تعذّر قراءة brc.staff: ' + errText(found, 'سكيما brc غير مُعرَّضة أو مفتاح الخدمة غير صالح') };
        var rows = Array.isArray(found.body) ? found.body : [];
        if (rows.length > 1) return { ok: false, error: 'سطور موظفين مكررة لنفس مستخدم الدخول — تُصلَح يدوياً في Supabase' };
        if (rows.length === 1) return patchStaffRow(key, rows[0].id, row, true);

        /* سطر بنفس اسم المستخدم (أُنشئ يدوياً أو من ترحيل سابق) */
        return staffRest(key, '?username=eq.' + encodeURIComponent(row.username) + '&select=id,username,auth_id').then(function (byName) {
          if (!byName.ok) return { ok: false, error: 'تعذّر قراءة brc.staff: ' + errText(byName) };
          var list = Array.isArray(byName.body) ? byName.body : [];
          if (list.length) {
            var r = list[0];
            /* اسم مستخدم مرتبط بمستخدم دخول آخر = حساب موظف فعلي قائم.
               ⚠️ لا نخطف حساباً قائماً ولا نُلغي ارتباطه — نرفض بوضوح. */
            if (r.auth_id && String(r.auth_id) !== String(authId)) {
              return { ok: false, code: 'username_taken',
                error: 'اسم المستخدم «' + row.username + '» مسجّل لموظف آخر — اختر اسماً آخر' };
            }
            return patchStaffRow(key, r.id, row, true);
          }
          return staffRest(key, '', {
            method: 'POST', body: Object.assign({ auth_id: authId }, row), prefer: 'return=representation'
          }).then(function (ins) {
            if (!ins.ok) return { ok: false, error: 'تعذّر إنشاء سطر الموظف: ' + errText(ins, 'تحقق من سكيما brc ومفتاح الخدمة') };
            return { ok: true, row: firstRow(ins.body), created: true };
          });
        });
      });
    }

    /* ------------------------- إنشاء حساب موظف كامل -------------------------
     *  Auth ثم brc.staff. كل الرفض قبل الشبكة حين يكون المدخل نفسه غير صالح،
     *  لأن حساب Auth لاسم لا يمكن الدخول به = نفاية دائمة (البريد المكرر يمنع
     *  إعادة استخدامه، فيبقى محجوزاً بلا صاحب).
     * ---------------------------------------------------------------------- */
    function createAccount(serviceKey, data) {
      data = data || {};
      var name = String(data.name == null ? '' : data.name).trim();
      var username = String(data.username == null ? '' : data.username).trim();
      var password = String(data.password == null ? '' : data.password);
      var role = data.role === 'admin' ? 'admin' : 'staff';
      var title = String(data.title == null ? '' : data.title).trim();
      var phone = String(data.phone == null ? '' : data.phone).trim();

      if (!serviceKey) {
        return Promise.resolve({ ok: false, code: 'no_key',
          error: 'مفتاح الخدمة (Service Role Key) مطلوب لإنشاء حسابات الموظفين — أضفه من الإعدادات ← «ربط السحابة»' });
      }
      if (!name) return Promise.resolve({ ok: false, code: 'no_name', error: 'الاسم الكامل مطلوب' });
      if (!looksUsable(username)) {
        return Promise.resolve({ ok: false, code: 'bad_username',
          error: 'اسم المستخدم غير صالح — حروف إنجليزية وأرقام ونقطة أو شرطة (خانتان على الأقل) وبلا مسافات، مثل: ahmed' });
      }
      if (password.length < 6) {
        return Promise.resolve({ ok: false, code: 'weak_password', error: 'كلمة المرور قصيرة — 6 خانات على الأقل' });
      }
      var email = toEmail(username);
      if (!email) return Promise.resolve({ ok: false, code: 'no_email', error: 'تعذّر اشتقاق البريد من اسم المستخدم' });

      /* فحص مبكر لاسم المستخدم: قبل إنشاء أي مستخدم Auth — وإلا بقي مستخدم
         Auth يتيم لا يدخل صاحبه ولا يُعاد استعمال اسمه. */
      return staffRest(serviceKey, '?username=eq.' + encodeURIComponent(username) + '&select=id,auth_id,username')
        .then(function (pre) {
          if (pre.ok && (Array.isArray(pre.body) ? pre.body : []).length) {
            var taken = pre.body[0];
            /* إن كان مرتبطاً بمستخدم دخول آخر فهو حساب قائم فعلاً — لا يُخطف */
            if (taken.auth_id) {
              return { ok: false, code: 'username_taken',
                error: 'اسم المستخدم «' + username + '» مسجّل لموظف آخر — اختر اسماً آخر' };
            }
          }
          return ensureAuthUser(serviceKey, email, password, name, username).then(function (ar) {
            if (!ar.ok) return ar;
            return linkStaffRow(serviceKey, ar.authId, { username: username, name: name, role: role, title: title, phone: phone })
              .then(function (sr) {
                if (!sr.ok) {
                  if (ar.existed === false) {
                    /* تراجع: أزل مستخدم Auth الذي أنشأناه في هذه الدعوة فلا يبقى أثر */
                    return adminApi(serviceKey, 'DELETE', '/auth/v1/admin/users/' + encodeURIComponent(ar.authId))
                      .then(function () { return { ok: false, code: sr.code || 'staff_row_failed', error: sr.error }; });
                  }
                  /* الخطوة الأولى نجحت والثانية لا: إعادة المحاولة من نفس النموذج تُكمل الربط */
                  return { ok: false, code: sr.code || 'staff_row_failed', authId: ar.authId, partial: true,
                    error: sr.error + ' — أعد المحاولة من نفس النموذج لإكمال الربط' };
                }
                return { ok: true, authId: ar.authId, staff: sr.row, email: email,
                  existed: !!ar.existed, repaired: !!(ar.existed || sr.repaired), passwordReset: !!ar.passwordReset };
              });
          });
        })
        .catch(function (e) {
          return { ok: false, code: 'network', error: 'خطأ شبكي: ' + (e && e.message || e) };
        });
    }

    /* ------------------------- تعديل حساب موظف قائم -------------------------
     *  الاسم والدور والمسمى والتنشيط. لا يمسّ كلمة المرور (لها دالة مستقلة).
     *  بلا مفتاح خدمة: نمرّ بجلسة المدير المُصادَقة (RLS تُجيزها) — فالتعديل يعمل
     *  في الوضعين: السحابي بمفتاح أو بلا مفتاح.
     * ---------------------------------------------------------------------- */
    function updateAccount(serviceKey, data) {
      data = data || {};
      var row = staffRowOf(data);
      var id = data.id || null;
      var base = baseUrl();

      function viaClient() {
        if (!cloudSessionAdmin()) return Promise.resolve({ ok: false, code: 'no_key',
          error: 'لا جلسة مدير مُصادَقة ولا مفتاح خدمة — أضف المفتاح من الإعدادات ← «ربط السحابة»' });
        var payload = { full_name: row.full_name, role: row.role, job_title: row.job_title, phone: row.phone, active: row.active };
        return client.from('staff').update(payload).eq('id', id).select()
          .then(function (res) {
            if (res && res.error) return { ok: false, error: 'تعذّر تحديث الموظف: ' + (res.error.message || res.error.code) };
            return { ok: true, row: firstRow(res && res.data) };
          })
          .catch(function (e) { return { ok: false, error: 'تعذّر تحديث الموظف: ' + (e && e.message || e) }; });
      }

      if (!base) return viaClient();
      if (serviceKey && id) {
        return staffRest(serviceKey, '?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH', body: { full_name: row.full_name, role: row.role, job_title: row.job_title, phone: row.phone, active: row.active },
          prefer: 'return=representation'
        }).then(function (res) {
          if (!res.ok) return { ok: false, error: 'تعذّر تحديث الموظف في القاعدة: ' + errText(res) };
          return { ok: true, row: firstRow(res.body) };
        });
      }
      if (serviceKey && row.username) {
        /* بلا معرّف: نبحث باسم المستخدم (سطر أُنشئ يدوياً مثلاً) */
        return staffRest(serviceKey, '?username=eq.' + encodeURIComponent(row.username) + '&select=id').then(function (f) {
          if (!f.ok) return { ok: false, error: 'تعذّر قراءة brc.staff: ' + errText(f) };
          var hit = (Array.isArray(f.body) ? f.body : [])[0];
          if (!hit) return viaClient();
          return staffRest(serviceKey, '?id=eq.' + encodeURIComponent(hit.id), {
            method: 'PATCH', body: { full_name: row.full_name, role: row.role, job_title: row.job_title, phone: row.phone, active: row.active },
            prefer: 'return=representation'
          }).then(function (res) {
            if (!res.ok) return { ok: false, error: 'تعذّر تحديث الموظف في القاعدة: ' + errText(res) };
            return { ok: true, row: firstRow(res.body) };
          });
        });
      }
      return viaClient();
    }

    /* --------------------------- حذف حساب موظف ---------------------------
     *  الترتيب مقصود: سطر brc.staff أولاً (فيُقطع الدخول فوراً: بلا سطر لا
     *  تُقرأ صلاحية، وbrc.is_staff تعود false)، ثم مستخدم Auth.
     *  بلا مفتاح خدمة نحذف السطر بجلسة المدير وتُبقى هوية Auth معلّقة بلا
     *  صلاحيات — وهذا مقبول أمنياً، ومذكور صراحةً للمدير.
     * ------------------------------------------------------------------ */
    function deleteAccount(serviceKey, data) {
      data = data || {};
      var id = data.id || null;
      var authId = data.authId || data.auth_id || null;
      var username = String(data.username || '').trim();
      var base = baseUrl();

      function clientDelete() {
        if (!id) return Promise.resolve({ ok: false, error: 'معرّف الموظف مفقود' });
        if (!cloudSessionAdmin()) return Promise.resolve({ ok: false, code: 'no_key',
          error: 'لا جلسة مدير مُصادَقة ولا مفتاح خدمة — أضف المفتاح من الإعدادات ← «ربط السحابة»' });
        return client.from('staff').delete().eq('id', id).select()
          .then(function (res) {
            if (res && res.error) return { ok: false, error: 'تعذّر حذف الموظف: ' + (res.error.message || res.error.code) };
            return { ok: true, rowDeleted: true, authDeleted: false, authKept: !!authId };
          })
          .catch(function (e) { return { ok: false, error: 'تعذّر حذف الموظف: ' + (e && e.message || e) }; });
      }

      function dropAuth(rowDeleted) {
        if (!serviceKey || !authId) return Promise.resolve({ ok: true, rowDeleted: rowDeleted, authDeleted: false, authKept: !!authId });
        return adminApi(serviceKey, 'DELETE', '/auth/v1/admin/users/' + encodeURIComponent(authId)).then(function (res) {
          if (!res.ok && res.status !== 404) {
            return { ok: true, rowDeleted: rowDeleted, authDeleted: false, authKept: true,
              note: 'حُذف الموظف لكن تعذّر حذف مستخدم الدخول: ' + errText(res) };
          }
          return { ok: true, rowDeleted: rowDeleted, authDeleted: true };
        });
      }

      if (!base) return clientDelete().then(function (r) { return r.ok ? dropAuth(r.rowDeleted) : r; });
      if (serviceKey && id) {
        return staffRest(serviceKey, '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=representation' })
          .then(function (res) {
            if (!res.ok) return { ok: false, error: 'تعذّر حذف سطر الموظف: ' + errText(res) };
            return dropAuth(true);
          });
      }
      if (serviceKey && username) {
        return staffRest(serviceKey, '?username=eq.' + encodeURIComponent(username) + '&select=id').then(function (f) {
          if (!f.ok) return { ok: false, error: 'تعذّر قراءة brc.staff: ' + errText(f) };
          var hit = (Array.isArray(f.body) ? f.body : [])[0];
          if (!hit) return clientDelete().then(function (r) { return r.ok ? dropAuth(r.rowDeleted) : r; });
          return staffRest(serviceKey, '?id=eq.' + encodeURIComponent(hit.id), { method: 'DELETE', prefer: 'return=representation' })
            .then(function (res) {
              if (!res.ok) return { ok: false, error: 'تعذّر حذف سطر الموظف: ' + errText(res) };
              return dropAuth(true);
            });
        });
      }
      return clientDelete().then(function (r) { return r.ok ? dropAuth(r.rowDeleted) : r; });
    }

    /* ------------------- تغيير كلمة مرور موظف (بيد المدير) -------------------
     *  كلمة مرور الموظف في Auth لا يملكها المدير: تغييرها يحتاج مفتاح الخدمة.
     * -------------------------------------------------------------------- */
    function setPassword(serviceKey, authId, newPassword) {
      if (!serviceKey) return Promise.resolve({ ok: false, code: 'no_key', error: 'مفتاح الخدمة مطلوب لتغيير كلمة مرور موظف' });
      if (!authId) return Promise.resolve({ ok: false, error: 'معرّف مستخدم الدخول مفقود لهذا الموظف' });
      if (String(newPassword == null ? '' : newPassword).length < 6) {
        return Promise.resolve({ ok: false, code: 'weak_password', error: 'كلمة المرور قصيرة — 6 خانات على الأقل' });
      }
      return setAuthPassword(serviceKey, authId, String(newPassword)).then(function (res) {
        if (!res.ok) return { ok: false, error: 'تعذّر تغيير كلمة المرور: ' + errText(res) };
        return { ok: true };
      });
    }

    /* هل الجلسة الحالية جلسة مدير مُصادَقة؟ (يُستخدم لمسار RLS بلا مفتاح) */
    function cloudSessionAdmin() {
      try {
        return !!(root.HRCStore && root.HRCStore.isAdmin && root.HRCStore.isAdmin());
      } catch (e) { return false; }
    }

    /* ---------------------------------------------------------------------------
     *  فحص مفتاح الخدمة **قبل** حفظه
     *  ---------------------------------------------------------------------------
     *  لماذا؟ المفتاح يُحفظ في متصفح المدير ثم تُبنى عليه كل عمليات الحسابات؛ ولو
     *  كان خاطئاً (مفتاح anon مثلاً، أو من مشروع آخر) فالخطأ لا يظهر إلا لحظة
     *  إنشاء أول موظف — ويظهر غامضاً. هنا نقرأ سطراً واحداً من brc.staff بالمفتاح،
     *  فنُميّز ثلاث حالات مختلفة العلاج: مفتاح مرفوض · سكيما غير مكشوفة · شبكة.
     * ------------------------------------------------------------------------ */
    function probeServiceKey(key) {
      if (!key) return Promise.resolve({ ok: false, code: 'no_key', error: 'لم يُدخل أي مفتاح' });
      return staffRest(key, '?select=id&limit=1').then(function (res) {
        if (res && res.ok) return { ok: true };
        var body = (res && res.body) || {};
        var msg = String(body.message || body.error_description || (res && res.error) || '');
        var pgCode = String(body.code || '');
        if (res && (res.status === 401 || res.status === 403)) {
          return { ok: false, code: 'bad_key', status: res.status,
            error: 'المفتاح مرفوض من القاعدة — تأكد أنه «service_role» من نفس المشروع (Settings → API Keys)' };
        }
        if (pgCode === 'PGRST205' || /schema|does not exist/i.test(msg)) {
          return { ok: false, code: 'schema', status: (res && res.status) || 0,
            error: 'المفتاح يبدو صحيحاً لكن سكيما brc غير مكشوفة — أضفها في Project Settings → API → Exposed schemas' };
        }
        if (res && res.status === 0) return { ok: false, code: 'network', error: 'تعذّر الوصول إلى القاعدة — تحقق من الاتصال بالإنترنت' };
        return { ok: false, code: 'probe_failed', status: (res && res.status) || 0,
          error: 'تعذّر التحقق من المفتاح: ' + (msg || 'رد غير متوقع') };
      });
    }

    /* ==========================================================================
     *  إدارة الحسابات عبر الدالة السحابية hrc-staff-admin — **بلا أي مفتاح في المتصفح**
     *  --------------------------------------------------------------------------
     *  ⚠️ لماذا لا يُوضع مفتاح الخدمة في الواجهة؟ لأن أي ملف تنزّله الصفحة يقرأه
     *     صاحبها (أدوات المتصفح → المصادر)، ومفتاح الخدمة يتجاوز كل سياسات RLS:
     *     من يحصل عليه يقرأ بيانات كل الباحثين ويحذف القاعدة وينشئ مديرين. ولا
     *     يوجد في تطبيق يعمل كله في المتصفح ملفٌ «لا يُرى».
     *     فالمفتاح يبقى في خوادم Supabase (بيئة الدالة)، والدالة تتحقق من أن
     *     المُنادي **مدير نشط** في brc.staff قبل أن تفعل أي شيء.
     *  ⇒ بهذا ينشئ أي مدير حسابات موظفيه من أي متصفح، وبلا لصق أي مفتاح.
     *  إن لم تكن الدالة منشورة بعد نُبلّغ not_deployed فيسلك المستدعي مسار
     *  مفتاح الخدمة إن وُجد (توافقية)، وإلا الوضع المحلي.
     * ======================================================================== */
    /* ⚠️ نصوص المكتبة الإنجليزية التي تصل للمدير عند فشل النقل (لا عند رفض
       الصلاحية): «Failed to send a request to the Edge Function» وغيرها. تُستبدل
       بجملة عربية، لأنها تظهر في نموذج الموظف مباشرةً ولا معنى لها للمستخدم. */
    var NET_FALLBACK = 'تعذّر الوصول إلى دالة الحسابات — تحقق من الاتصال بالإنترنت ثم أعد المحاولة';
    function looksEnglish(s) { return !!s && !/[\u0600-\u06FF]/.test(s) && /[A-Za-z]{4}/.test(s); }

    function fnErrorOf(err) {
      var status = (err && err.context && err.context.status) || 0;
      function done(body) {
        /* ⚠️ الدالة غير المنشورة تُرجع 404 بالإنجليزية ("Requested function was
           not found") — وهي أول ما يراه المدير على مشروع لم تُنشر فيه الدالة بعد.
           نُترجمها إلى جملة عربية تُسمّي الخطوة بدل تسريب نص إنجليزي غامض. */
        if (status === 404) {
          return { ok: false, status: status, code: 'not_deployed',
            error: 'الدالة السحابية hrc-staff-admin غير منشورة على مشروع Supabase — انظر docs/staff-accounts-edge.md' };
        }
        var msg = (body && (body.error || body.message)) || (err && err.message) || 'خطأ غير معروف';
        var code = (body && body.code) || 'fn_error';
        /* لا جسم رد (فشل نقل) أو نص إنجليزي بلا جملة عربية → جملة عربية موحّدة،
           وcode='network' ليعرف المستدعي أن هذا «لا وصول» لا «رفض صلاحية»:
           الأول يجوز معه المسار الاحتياطي (مفتاح الخدمة)، والثاني لا يجوز. */
        if (!body && (status === 0 || status >= 500)) {
          return { ok: false, status: status, code: 'network', error: NET_FALLBACK };
        }
        if (looksEnglish(msg)) msg = NET_FALLBACK;
        return { ok: false, status: status, code: code, error: msg };
      }
      var ctx = err && err.context;
      if (ctx && typeof ctx.json === 'function') {
        return Promise.resolve().then(function () { return ctx.json(); }).then(done).catch(function () { return done(null); });
      }
      return Promise.resolve(done(null));
    }

    function staffAdmin(action, payload) {
      var fn = client && client.functions;
      if (!fn || typeof fn.invoke !== 'function') {
        return Promise.resolve({ ok: false, code: 'not_deployed', error: 'عميل الدوال غير متاح في هذه النسخة من المكتبة' });
      }
      var body = Object.assign({ action: action }, payload || {});
      if (!body.domain) body.domain = cfg().domain;
      return Promise.resolve(fn.invoke('hrc-staff-admin', { body: body }))
        .then(function (res) {
          var err = res && res.error;
          if (err) return fnErrorOf(err);
          var d = res && res.data;
          if (d && typeof d === 'object') {
            if (d.ok === false) return d;
            return Object.assign({ ok: true }, d);
          }
          return { ok: false, code: 'empty', error: 'لا رد مفهوم من الدالة السحابية' };
        })
        .catch(function (e) {
          return { ok: false, code: 'network', error: 'تعذّر الوصول إلى دالة الحسابات: ' + (e && e.message || e) };
        });
    }

    return {
      login: login, logout: logout, restore: restore, sessionOnly: sessionOnly, profileFor: profileFor,
      changePassword: changePassword, toEmail: toEmail, loadProfile: loadProfile,
      createAccount: createAccount, updateAccount: updateAccount,
      deleteAccount: deleteAccount, setPassword: setPassword,
      findAuthUser: findAuthUser, looksUsable: looksUsable,
      probeServiceKey: probeServiceKey,
      staffAdmin: staffAdmin
    };
  }

  root.HRCCloudAuth = {
    create: create,
    toEmail: toEmail,
    looksUsable: looksUsable
  };
})(typeof window !== 'undefined' ? window : globalThis);
