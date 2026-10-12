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
      domain: c.authEmailDomain || 'hrc-babil.com'
    };
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
    function login(usernameOrEmail, password) {
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
    function restore() {
      return client.auth.getSession()
        .then(function (res) {
          var session = res && res.data ? res.data.session : null;
          if (!session || !session.user) return { ok: false, code: 'no_session' };
          return loadProfile(client, session.user).then(function (prof) {
            if (!prof) return { ok: false, code: 'no_staff_row', user: session.user };
            if (prof.active === false) return { ok: false, code: 'inactive' };
            return { ok: true, user: session.user, session: session, profile: prof };
          });
        })
        .catch(function (e) { return { ok: false, code: 'network', error: String(e && e.message || e) }; });
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

    /* ---------------------------- إنشاء حساب موظف ---------------------------- */
    function createAccount(serviceKey, data) {
      if (!serviceKey) return Promise.resolve({ ok: false, error: 'مفتاح الخدمة (Service Role Key) مطلوب — أضفه من الإعدادات' });
      if (!data || !data.username || !data.password || !data.name) return Promise.resolve({ ok: false, error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة' });

      var email = toEmail(data.username);
      if (!email) return Promise.resolve({ ok: false, error: 'تعذّر اشتقاق البريد من اسم المستخدم' });

      var url = (client.supabaseUrl || '').replace(/\/+$/, '');
      if (!url) return Promise.resolve({ ok: false, error: 'رابط Supabase غير مُعرّف' });

      /* 1) إنشاء حساب Auth */
      var authUrl = url + '/auth/v1/admin/users';
      return fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey
        },
        body: JSON.stringify({
          email: email,
          password: data.password,
          email_confirm: true,
          user_metadata: { full_name: data.name, username: data.username }
        })
      })
      .then(function (res) { return res.json(); })
      .then(function (authRes) {
        if (authRes.error || authRes.msg) {
          var msg = authRes.error_description || authRes.msg || authRes.error || 'خطأ غير معروف';
          if (/already.*registered|already.*exists|user.*exists/i.test(msg)) {
            return { ok: false, error: 'البريد مسجّل مسبقاً في Supabase Auth' };
          }
          return { ok: false, error: 'خطأ Auth: ' + msg };
        }
        var authId = authRes.id || (authRes.user && authRes.user.id);
        if (!authId) return { ok: false, error: 'لم يُرجِع Auth معرّف المستخدم' };

        /* 2) إدراج سطر في brc.staff */
        return client.from('staff').insert({
          auth_id: authId,
          username: data.username,
          full_name: data.name,
          role: data.role || 'staff',
          job_title: data.title || '',
          phone: data.phone || '',
          active: true
        }).select().single()
        .then(function (res) {
          if (res && res.error) {
            return { ok: false, error: 'تم إنشاء Auth لكن فشل إدراج staff: ' + (res.error.message || res.error.details) };
          }
          return { ok: true, authId: authId, staff: res.data };
        });
      })
      .catch(function (e) {
        return { ok: false, error: 'خطأ شبكي: ' + (e && e.message || e) };
      });
    }

    return {
      login: login, logout: logout, restore: restore,
      changePassword: changePassword, toEmail: toEmail, loadProfile: loadProfile,
      createAccount: createAccount
    };
  }

  root.HRCCloudAuth = {
    create: create,
    toEmail: toEmail,
    looksUsable: looksUsable
  };
})(typeof window !== 'undefined' ? window : globalThis);
