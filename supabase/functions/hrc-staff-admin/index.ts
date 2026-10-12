/* ===========================================================================
 *  HRC — دالة إدارة حسابات الموظفين (Supabase Edge Function)
 *  ---------------------------------------------------------------------------
 *  لماذا هذه الدالة موجودة؟
 *  لإنشاء حساب في Supabase Auth يلزم «مفتاح خدمة» (Service Role Key) يملك كل
 *  شيء في القاعدة: قراءة بيانات كل الباحثين، حذف الوظائف، إنشاء مديرين…
 *  وضعه في الواجهة — ولو في ملف «مخفي» أو مُشفّر أو مُصغّر — يعني تسليمه لكل
 *  زائر يفتح أدوات المتصفح: كل ملف ينزّله المتصفح يقرأه صاحبه، ولا يوجد في
 *  تطبيق يعمل كله في المتصفح ملفٌ «لا يُرى». فلا سرّ في الواجهة أبداً.
 *
 *  فالملف هذا يعيش في مكان واحد لا يصل إليه المتصفح: خوادم Supabase.
 *  المفتاح يأتي من بيئة التشغيل (SUPABASE_SERVICE_ROLE_KEY) ولا يمرّ بالشبكة
 *  إلى أي متصفح إطلاقاً.
 *
 *  الأمان — كل الشروط داخل الكود لا في إعدادات يمكن نسيانها:
 *    1) لا تُقبل دعوة بلا ترويسة Authorization تحمل توكن جلسة.
 *    2) التوكن يُتحقق منه عند GoTrue نفسه (auth.getUser) — لا نثق بمحتواه.
 *    3) ويُشترط أن يكون صاحبه **مديراً نشطاً** في brc.staff، وإلا 403.
 *       ⇒ أي موظف عادي ينادي الدالة لا يستطيع إنشاء حساب ولا تعديله ولا حذفه.
 *    4) المدير لا يحذف نفسه ولا يعطّل نفسه ولا يغيّر دوره (حماية من قفل الحساب).
 *    5) اسم مستخدم محجوز لموظف آخر لا يُخطف (نفس قواعد الواجهة).
 *    6) كل الردود JSON بجملة عربية مفهومة، ولا تُسرّب تفاصيل داخلية.
 *
 *  ⚠️ داخل الدالة نستعمل مفتاح الخدمة للوصول للقاعدة (يتجاوز RLS عمداً)، لأن
 *     التحقق من الصلاحية مسؤولية السطور أعلاه — ولهذا كل مسار يبدأ بفحص المدير.
 *
 *  التشغيل:
 *    • من لوحة Supabase: Edge Functions → Deploy a new function →
 *      الاسم بالضبط: hrc-staff-admin → الصق هذا الملف → Deploy
 *      (أبقِ «Enforce JWT verification» مفعّلاً — الافتراضي — طبقة زائدة).
 *    • أو من الطرفية:  supabase functions deploy hrc-staff-admin
 *  التفاصيل والتحقق: docs/staff-accounts-edge.md
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SCHEMA = 'brc';
const DEFAULT_DOMAIN = 'hrc-babil.com';
const USERNAME_RE = /^[A-Za-z0-9._-]{2,}$/;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/* CORS: أصل الواجهة — يُقيَّد بمتغيّر HRC_ALLOWED_ORIGIN إن ضُبط، وإلا *.
   الأمان هنا لا يعتمد على CORS إطلاقاً: التوكن والتحقق من الدور هما الحاجز. */
function corsHeaders() {
  const allowed = Deno.env.get('HRC_ALLOWED_ORIGIN') || '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function fail(error: string, status = 400, code = 'error') {
  return json({ ok: false, code, error }, status);
}

function str(v: unknown): string {
  return String(v == null ? '' : v).trim();
}

/* اسم المستخدم → البريد المشتقّ (نفس القاعدة في assets/js/cloud-auth.js) */
function emailFor(username: string, domain: string): string {
  const v = str(username).toLowerCase();
  if (v.indexOf('@') >= 0) return v;
  return v + '@' + domain;
}

/* ---------------------------- فحص المدير ---------------------------- */
async function callerIsAdmin(admin: any, authId: string) {
  const { data, error } = await admin
    .from('staff')
    .select('id, username, role, active')
    .eq('auth_id', authId)
    .limit(1);
  if (error) return { ok: false, reason: 'query_failed', detail: error.message };
  const row = (data || [])[0];
  if (!row) return { ok: false, reason: 'no_staff_row' };
  if (row.active === false) return { ok: false, reason: 'inactive' };
  if (row.role !== 'admin') return { ok: false, reason: 'not_admin' };
  return { ok: true, staff: row };
}

/* ------------------------ مستخدمو Auth ------------------------ */
async function findAuthUserByEmail(admin: any, email: string) {
  /* لا مرشّح بالبريد في واجهة الإدارة — نُصفّح (بحدّ أعلى يمنع حلقة لا نهائية) */
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { error: error.message || 'تعذّر قراءة مستخدمي Auth' };
    const users = (data && data.users) || [];
    const hit = users.find((u: any) => String(u.email || '').toLowerCase() === email);
    if (hit) return { user: hit };
    if (users.length < 200) return { user: null };
  }
  return { user: null };
}

/* إنشاء مستخدم Auth أو إكمال الموجود (تكرار آمن: حساب نصف جاهز لا يُغلق للأبد) */
async function ensureAuthUser(admin: any, email: string, password: string, name: string, username: string) {
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: name, username }
  });
  if (!created.error && created.data && created.data.user) {
    return { ok: true, authId: created.data.user.id, existed: false };
  }
  const msg = String((created.error && created.error.message) || '');
  if (!/already|exist|registered/i.test(msg)) {
    return { ok: false, error: 'خطأ من خدمة الحسابات: ' + (msg || 'غير معروف') };
  }
  const found = await findAuthUserByEmail(admin, email);
  if (found.error) return { ok: false, error: found.error };
  if (!found.user) {
    return { ok: false, error: 'البريد مسجّل في Auth لكن تعذّر العثور على مستخدمه — راجع مستخدمي المشروع' };
  }
  /* كلمة المرور تُضبط على ما أعطاه المدير: وعدُ «هذه كلمة مرورك» يجب أن يصحّ */
  const upd = await admin.auth.admin.updateUserById(found.user.id, { password });
  return { ok: true, authId: found.user.id, existed: true, passwordReset: !upd.error };
}

/* ------------------------ سطر brc.staff ------------------------ */
async function patchRow(admin: any, id: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from('staff').update(row).eq('id', id).select();
  if (error) return { ok: false, error: 'تعذّر تحديث سطر الموظف: ' + error.message };
  return { ok: true, row: (data || [])[0] || null, repaired: true };
}

async function linkStaffRow(admin: any, authId: string, data: any) {
  const row = {
    username: str(data.username),
    full_name: str(data.name),
    role: data.role === 'admin' ? 'admin' : 'staff',
    job_title: str(data.title),
    phone: str(data.phone),
    active: data.active !== false
  };

  const byAuth = await admin.from('staff').select('id, username, auth_id').eq('auth_id', authId);
  if (byAuth.error) return { ok: false, error: 'تعذّر قراءة brc.staff: ' + byAuth.error.message };
  const authRows = byAuth.data || [];
  if (authRows.length > 1) return { ok: false, error: 'سطور موظفين مكررة لنفس مستخدم الدخول — تُصلَح يدوياً' };
  if (authRows.length === 1) return patchRow(admin, authRows[0].id, row);

  const byName = await admin.from('staff').select('id, username, auth_id').eq('username', row.username);
  if (byName.error) return { ok: false, error: 'تعذّر قراءة brc.staff: ' + byName.error.message };
  const nameRows = byName.data || [];
  if (nameRows.length) {
    const r = nameRows[0];
    /* اسم مرتبط بمستخدم دخول آخر = حساب موظف قائم فعلاً — لا نخطفه */
    if (r.auth_id && String(r.auth_id) !== String(authId)) {
      return { ok: false, code: 'username_taken',
        error: 'اسم المستخدم «' + row.username + '» مسجّل لموظف آخر — اختر اسماً آخر' };
    }
    return patchRow(admin, r.id, row);
  }

  const ins = await admin.from('staff').insert({ auth_id: authId, ...row }).select();
  if (ins.error) return { ok: false, error: 'تعذّر إنشاء سطر الموظف: ' + ins.error.message };
  return { ok: true, row: (ins.data || [])[0] || null, created: true };
}

/* ============================== الإجراءات ============================== */

async function actCreate(admin: any, body: any, domain: string) {
  const name = str(body.name);
  const username = str(body.username);
  const password = String(body.password == null ? '' : body.password);
  if (!name) return fail('الاسم الكامل مطلوب', 400, 'no_name');
  if (!USERNAME_RE.test(username)) {
    return fail('اسم المستخدم غير صالح — حروف إنجليزية وأرقام ونقطة أو شرطة (خانتان على الأقل) وبلا مسافات، مثل: ahmed', 400, 'bad_username');
  }
  if (password.length < 6) return fail('كلمة المرور قصيرة — 6 خانات على الأقل', 400, 'weak_password');

  /* ---- فحص مبكر لاسم المستخدم: قبل إنشاء أي مستخدم Auth ----
     بلا هذا الفحص نُنشئ مستخدم Auth ثم نكتشف أن الاسم محجوز لموظف آخر فنبقى
     بمستخدم Auth يتيم (اسمه محجوز فلا يُعاد استعماله). الفحص الآن يمنع ذلك من
     أصله، والتراجع أدناه شبكة أمان لحالة سباق نادرة. */
  const pre = await admin.from('staff').select('id, auth_id, username').eq('username', username).limit(1);
  if (!pre.error && (pre.data || []).length) {
    return fail('اسم المستخدم «' + username + '» مسجّل لموظف آخر — اختر اسماً آخر', 409, 'username_taken');
  }

  const email = emailFor(username, domain);
  const ar = await ensureAuthUser(admin, email, password, name, username);
  if (!ar.ok) return fail(ar.error as string, 502, 'auth_failed');

  const sr = await linkStaffRow(admin, ar.authId as string, { ...body, username });
  if (!sr.ok) {
    /* تراجع: إن كان مستخدم Auth من إنشائنا في هذه الدعوة ولا سطر موظف له، نُزيله
       فلا نترك أثراً لحساب لا يستطيع صاحبه الدخول ولا يُعاد استعمال اسمه. */
    if (ar.existed === false) {
      await admin.auth.admin.deleteUser(ar.authId as string);
      return fail(sr.error as string, 502, (sr as any).code || 'staff_row_failed');
    }
    /* الخطوة الأولى نجحت والثانية لا: نصرّح بذلك ليكملها المدير بإعادة المحاولة */
    return json({ ok: false, code: (sr as any).code || 'staff_row_failed', authId: ar.authId, partial: true,
      error: sr.error + ' — أعد المحاولة من نفس النموذج لإكمال الربط' }, 502);
  }
  return json({ ok: true, authId: ar.authId, email, staff: sr.row,
    existed: !!ar.existed, repaired: !!(ar.existed || (sr as any).repaired), passwordReset: !!ar.passwordReset });
}

async function actUpdate(admin: any, body: any, meId: string) {
  const id = str(body.id);
  if (!id) return fail('معرّف الموظف مفقود', 400, 'no_id');

  if (id === meId) {
    /* المدير يعدّل سطره: مسموح للاسم/المسمى/الهاتف، ممنوع الدور والتنشيط */
    const self = {
      full_name: str(body.name) || undefined,
      job_title: body.title !== undefined ? str(body.title) : undefined,
      phone: body.phone !== undefined ? str(body.phone) : undefined
    };
    Object.keys(self).forEach((k) => (self as any)[k] === undefined && delete (self as any)[k]);
    const r = await patchRow(admin, id, self);
    if (!r.ok) return fail(r.error as string, 502, 'staff_row_failed');
    return json({ ok: true, staff: r.row, selfLimited: true });
  }

  const row: Record<string, unknown> = {
    full_name: str(body.name),
    role: body.role === 'admin' ? 'admin' : 'staff',
    job_title: str(body.title),
    phone: str(body.phone),
    active: body.active !== false
  };
  const r = await patchRow(admin, id, row);
  if (!r.ok) return fail(r.error as string, 502, 'staff_row_failed');
  return json({ ok: true, staff: r.row });
}

async function actDelete(admin: any, body: any, meId: string, meUsername: string) {
  const id = str(body.id);
  const authId = str(body.authId || body.auth_id);
  const username = str(body.username);
  if (!id && !authId && !username) return fail('معرّف الموظف مفقود', 400, 'no_id');

  /* أين السطر؟ */
  let target: any = null;
  if (id) {
    const q = await admin.from('staff').select('id, auth_id, username').eq('id', id).limit(1);
    if (q.error) return fail('تعذّر قراءة brc.staff: ' + q.error.message, 502, 'staff_read');
    target = (q.data || [])[0] || null;
  } else if (authId) {
    const q = await admin.from('staff').select('id, auth_id, username').eq('auth_id', authId).limit(1);
    if (q.error) return fail('تعذّر قراءة brc.staff: ' + q.error.message, 502, 'staff_read');
    target = (q.data || [])[0] || null;
  } else {
    const q = await admin.from('staff').select('id, auth_id, username').eq('username', username).limit(1);
    if (q.error) return fail('تعذّر قراءة brc.staff: ' + q.error.message, 502, 'staff_read');
    target = (q.data || [])[0] || null;
  }

  /* حماية: لا يحذف المدير حسابه هو */
  if (target && (String(target.id) === String(meId) || String(target.username) === String(meUsername))) {
    return fail('لا يمكنك حذف حسابك الحالي', 400, 'self_delete');
  }

  let rowDeleted = false;
  if (target) {
    const del = await admin.from('staff').delete().eq('id', target.id);
    if (del.error) return fail('تعذّر حذف سطر الموظف: ' + del.error.message, 502, 'staff_row_failed');
    rowDeleted = true;
  }

  /* ثم مستخدم الدخول: بلا سطر لا صلاحيات، لكن نُزيله كي لا يبقى اسم محجوزاً */
  const targetAuth = (target && target.auth_id) || authId || null;
  let authDeleted = false;
  if (targetAuth) {
    const del = await admin.auth.admin.deleteUser(String(targetAuth));
    authDeleted = !del.error;
  }
  return json({ ok: true, rowDeleted, authDeleted, authKept: !!targetAuth && !authDeleted });
}

async function actSetPassword(admin: any, body: any) {
  const authId = str(body.authId || body.auth_id);
  const password = String(body.password == null ? '' : body.password);
  if (!authId) return fail('معرّف مستخدم الدخول مفقود لهذا الموظف', 400, 'no_auth_id');
  if (password.length < 6) return fail('كلمة المرور قصيرة — 6 خانات على الأقل', 400, 'weak_password');
  const upd = await admin.auth.admin.updateUserById(authId, { password });
  if (upd.error) return fail('تعذّر تغيير كلمة المرور: ' + upd.error.message, 502, 'password_failed');
  return json({ ok: true });
}

/* ============================== نقطة الدخول ============================== */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return fail('الطريقة غير مدعومة', 405, 'bad_method');

  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceKey) {
    return fail('إعداد الدالة ناقص: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', 500, 'not_configured');
  }

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail('الجلسة مطلوبة — سجّل الدخول كمدير', 401, 'no_token');

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: SCHEMA }
  });

  /* 1) من هو المتصل؟ (التحقق عند GoTrue نفسه — لا نثق بمحتوى التوكن) */
  const userRes = await admin.auth.getUser(token);
  if (userRes.error || !userRes.data || !userRes.data.user) {
    return fail('الجلسة منتهية أو غير صالحة — أعد الدخول', 401, 'bad_token');
  }
  const callerAuthId = userRes.data.user.id;

  /* 2) هل هو مدير نشط؟ */
  const who = await callerIsAdmin(admin, callerAuthId);
  if (!who.ok) {
    if (who.reason === 'inactive') return fail('الحساب موقوف — راجع الإدارة', 403, 'inactive');
    if (who.reason === 'not_admin') return fail('هذه الصلاحية للمدير العام فقط', 403, 'not_admin');
    if (who.reason === 'query_failed') return fail('تعذّر التحقق من الصلاحية', 500, 'check_failed');
    return fail('الحساب غير مرتبط بموظف — أضف سطراً في brc.staff', 403, 'no_staff_row');
  }
  const me = who.staff;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('الطلب غير مفهوم (JSON مطلوب)', 400, 'bad_body');
  }

  const action = str(body && body.action);
  const domain = Deno.env.get('HRC_AUTH_DOMAIN') ||
    (DOMAIN_RE.test(str(body && body.domain)) ? str(body.domain) : DEFAULT_DOMAIN);

  try {
    if (action === 'create') return await actCreate(admin, body, domain);
    if (action === 'update') return await actUpdate(admin, body, me.id);
    if (action === 'delete') return await actDelete(admin, body, me.id, me.username);
    if (action === 'set-password') return await actSetPassword(admin, body);
    if (action === 'whoami') return json({ ok: true, staff: me });
    return fail('إجراء غير معروف: ' + action, 400, 'bad_action');
  } catch (e) {
    /* لا نُسرّب تفاصيل داخلية — سطر واحد في سجل الدالة يكفي للتشخيص */
    console.error('[hrc-staff-admin]', action, e instanceof Error ? e.message : String(e));
    return fail('خطأ غير متوقع في الدالة — راجع سجل الدالة في لوحة Supabase', 500, 'unexpected');
  }
});
