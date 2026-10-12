#!/usr/bin/env node
/* ===========================================================================
 *  HRC — اختبار دالة إدارة الحسابات السحابية (الكود الفعلي، لا نسخة منه)
 *  ---------------------------------------------------------------------------
 *  هذه الدالة هي التي تحمل مفتاح الخدمة (Service Role Key) — أي أنها الحاجز
 *  الوحيد بين موظف عادي وبين القدرة على إنشاء مديرين أو حذف القاعدة. فلا يكفي
 *  أن «تبدو» صحيحة: نُشغّل **ملف الدالة نفسه** (supabase/functions/
 *  hrc-staff-admin/index.ts) داخل Node مع عميل سوبابيس وهمي وبيئة Deno مصغّرة،
 *  ثم نضربها بطلبات HTTP حقيقية (Request/Response) ونتحقق من كل مسار:
 *
 *    • بلا توكن / بتوكن باطل / بحساب موظف عادي ⇒ مرفوض ولا يُنشأ شيء.
 *    • بحساب مدير نشط ⇒ ينشئ Auth + سطر brc.staff في عملية واحدة.
 *    • اسم مستخدم عربي/بمسافة أو كلمة مرور قصيرة ⇒ مرفوض قبل أي إنشاء.
 *    • اسم محجوز لموظف آخر ⇒ مرفوض ولا يُنشأ مستخدم Auth يتيم.
 *    • حساب نصف جاهز (Auth بلا سطر) ⇒ يُكمَل ويُربط ولا يُغلق على صاحبه.
 *    • المدير لا يحذف نفسه ولا يغيّر دوره (حماية من قفل النظام).
 *    • الحذف يزيل السطر ومستخدم الدخول معاً.
 *
 *  التشغيل:  node --experimental-strip-types tests/staff-admin-function.mjs
 *  (الخيار مطلوب لأن ملف الدالة TypeScript — يقرأه Node ويجرده من الأنواع.)
 * =========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

/* ---------------------------------------------------------------------------
 *  تشغيل ذاتي بلا تعليمات إضافية: ملف الدالة TypeScript، وNode يقرأه بتجريد
 *  الأنواع (‎--experimental-strip-types، متاح من Node 22.6). لو نُفِّذ هذا الملف
 *  بلا الخيار نُعيد تشغيل أنفسنا به — فلا يعتمد الاختبار على أن يتذكّر أحد.
 * ------------------------------------------------------------------------- */
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 6)) {
    console.log('\n⚠️ اختبار الدالة السحابية يحتاج Node 22.6 أو أحدث (الحالي ' + process.versions.node + ')');
    console.log('   الدالة نفسها تعمل على Deno في Supabase ولا يتأثر الإنتاج بهذا الاختبار.\n');
    process.exit(1);
  }
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_SRC = join(ROOT, 'supabase', 'functions', 'hrc-staff-admin', 'index.ts');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

console.log('\n' + '═'.repeat(74));
console.log('  HRC — دالة إدارة حسابات الموظفين (الكود الفعلي)');
console.log('═'.repeat(74));

/* ===========================================================================
 *  0) فحوص ثابتة على الملف: لا سرّ مدفون، ولا اعتماد على إعداد خارجي للتحقق
 * =========================================================================== */
step(0, 'سلامة الملف — لا مفاتيح في الكود، والتحقق داخل الكود لا في الإعدادات');
const SRC = readFileSync(FN_SRC, 'utf8');
check('لا مفتاح خدمة مكتوب في الملف (يُقرأ من بيئة التشغيل فقط)',
  !/sb_secret_[A-Za-z0-9]/.test(SRC) && !/eyJ[A-Za-z0-9_-]{10,}\./.test(SRC));
check('يقرأ المفتاح من SUPABASE_SERVICE_ROLE_KEY', /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/.test(SRC));
check('يفحص ترويسة Authorization', /Authorization/.test(SRC) && /no_token/.test(SRC));
check('يتحقق من التوكن عند GoTrue (لا يثق بمحتواه)', /auth\.getUser\(token\)/.test(SRC));
check('يشترط دور المدير صراحةً', /callerIsAdmin/.test(SRC) && /role !== 'admin'/.test(SRC));
check('يحمي المدير من حذف حسابه نفسه', /self_delete/.test(SRC));

/* ===========================================================================
 *  بيئة التشغيل المصغّرة: عميل سوبابيس وهمي + Deno.env + Deno.serve
 * =========================================================================== */
function makeSupabaseMock(state) {
  const calls = [];
  state.sessions = state.sessions || {};        // token → { user } | null

  function from(table) {
    const q = { table, op: 'select', payload: null, filters: [], cols: '*' };
    const api = {
      select(cols) { if (q.op === 'select' && cols) q.cols = cols; else if (q.op !== 'select') q.post = 'select'; return api; },
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filters.push([c, v]); return api; },
      limit(n) { q.limit = n; return api; },
      order() { return api; }, single() { return api; },
      then(res, rej) { return Promise.resolve(exec(q)).then(res, rej); }
    };
    function rowsMatching() {
      return (state[table] || []).filter((r) => q.filters.every(([c, v]) => String(r[c] ?? '') === String(v)));
    }
    function exec(query) {
      calls.push({ table, op: query.op, payload: query.payload, filters: query.filters });
      if (query.op === 'select') return { data: rowsMatching(), error: null };
      if (query.op === 'update') {
        const hit = rowsMatching();
        if (!hit.length) return { data: [], error: null };
        hit.forEach((r) => Object.assign(r, query.payload));
        return { data: hit, error: null };
      }
      if (query.op === 'insert') {
        const row = Object.assign({ id: table + '-' + ((state[table] || []).length + 1) }, query.payload);
        (state[table] = state[table] || []).push(row);
        return { data: [row], error: null };
      }
      if (query.op === 'delete') {
        const hit = rowsMatching();
        state[table] = (state[table] || []).filter((r) => hit.indexOf(r) < 0);
        return { data: hit, error: null };
      }
      return { data: null, error: null };
    }
    return api;
  }

  const client = {
    __calls: calls, __state: state,
    from,
    auth: {
      getUser(token) {
        const sess = state.sessions[token];
        return Promise.resolve(sess
          ? { data: { user: sess.user }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } });
      },
      admin: {
        createUser({ email, password, email_confirm, user_metadata }) {
          calls.push({ auth: 'createUser', email });
          const users = state.authUsers;
          if (users.some((u) => u.email === email)) {
            return Promise.resolve({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } });
          }
          const u = { id: 'auth-' + (users.length + 1), email, password, email_confirm, user_metadata };
          users.push(u);
          return Promise.resolve({ data: { user: u }, error: null });
        },
        listUsers({ page, perPage }) {
          calls.push({ auth: 'listUsers', page });
          const start = (page - 1) * perPage;
          return Promise.resolve({ data: { users: state.authUsers.slice(start, start + perPage) }, error: null });
        },
        updateUserById(id, patch) {
          calls.push({ auth: 'updateUserById', id, patch });
          const u = state.authUsers.filter((x) => x.id === id)[0];
          if (!u) return Promise.resolve({ data: { user: null }, error: { message: 'User not found' } });
          Object.assign(u, patch);
          return Promise.resolve({ data: { user: u }, error: null });
        },
        deleteUser(id) {
          calls.push({ auth: 'deleteUser', id });
          state.authUsers = state.authUsers.filter((x) => x.id !== id);
          return Promise.resolve({ data: {}, error: null });
        }
      }
    }
  };
  return client;
}

function freshState(opts = {}) {
  const state = {
    staff: [
      { id: 'staff-admin', auth_id: 'a-admin', username: 'hussein', full_name: 'حسين المدير', role: 'admin', job_title: 'مدير عام', phone: '0770', active: true },
      { id: 'staff-emp', auth_id: 'a-emp', username: 'ali', full_name: 'علي الموظف', role: 'staff', job_title: 'موظف', phone: '', active: true }
    ],
    authUsers: [
      { id: 'a-admin', email: 'hussein@hrc-babil.com', password: 'Admin@1234' },
      { id: 'a-emp', email: 'ali@hrc-babil.com', password: 'Ali@1234' }
    ],
    sessions: {
      'tok-admin': { user: { id: 'a-admin', email: 'hussein@hrc-babil.com' } },
      'tok-emp': { user: { id: 'a-emp', email: 'ali@hrc-babil.com' } },
      'tok-nobody': { user: { id: 'a-ghost', email: 'ghost@hrc-babil.com' } }
    }
  };
  Object.assign(state, opts.state || {});
  return state;
}

/* تهيئة بيئة Deno + تحميل ملف الدالة نفسه */
/* ⚠️ الملف المؤقت خارج المستودع: Node يرفض تجريد الأنواع من ملفات داخل
   node_modules، والمجلد المؤقت للنظام هو المكان الصحيح لنسخة تشغيل اختبارية. */
const TMP = join(tmpdir(), 'hrc-fn-test');
let handler = null;
let lastEnv = {};

function loadFunction(state, env = {}) {
  mkdirSync(TMP, { recursive: true });
  const stubPath = join(TMP, 'supabase-stub.mjs');
  const fnPath = join(TMP, 'fn.ts');

  writeFileSync(stubPath, `
export function createClient(url, key, opts) {
  if (typeof globalThis.__mkClient !== 'function') throw new Error('mock client missing');
  return globalThis.__mkClient(url, key, opts);
}
`, 'utf8');

  /* نُبدّل استيراد esm.sh (شبكة) بمحلي — بقية الملف كما هو حرفياً */
  const code = SRC.replace(/import\s*\{[^}]*\}\s*from\s*['"]https:\/\/esm\.sh[^'"]*['"];?/,
    "import { createClient } from './supabase-stub.mjs';");
  writeFileSync(fnPath, code, 'utf8');

  globalThis.__mkClient = () => makeSupabaseMock(state);
  lastEnv = Object.assign({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key-test' }, env);
  globalThis.Deno = {
    env: { get: (k) => (k in lastEnv ? lastEnv[k] : undefined) },
    serve: (h) => { handler = h; return Promise.resolve(); }
  };
  return import(pathToFileURL(fnPath).href + '?v=' + Math.random());
}

async function call({ body, method = 'POST', auth = null, tokenEnv = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + auth;
  const req = new Request('https://fn.local/hrc-staff-admin', {
    method,
    headers,
    body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined
  });
  void tokenEnv;
  const res = await handler(req);
  let json = null;
  try { json = await res.clone().json(); } catch (e) { }
  return { status: res.status, body: json, headers: res.headers };
}

/* ===========================================================================
 *  1) لا تصل الدعوة إلى أي إجراء بلا مدير نشط
 * =========================================================================== */
step(1, 'الحاجز الأول: بلا جلسة مدير نشط لا يُنفَّذ أي شيء');
{
  const state = freshState();
  await loadFunction(state);

  const noTok = await call({ body: { action: 'create', username: 'x1', password: 'Pass@123', name: 'اسم' } });
  check('بلا توكن: 401 ورمز no_token', noTok.status === 401 && noTok.body.code === 'no_token', JSON.stringify(noTok.body));

  const badTok = await call({ auth: 'tok-fake', body: { action: 'create', username: 'x1', password: 'Pass@123', name: 'اسم' } });
  check('بتوكن باطل: 401 ورمز bad_token', badTok.status === 401 && badTok.body.code === 'bad_token', JSON.stringify(badTok.body));

  const ghost = await call({ auth: 'tok-nobody', body: { action: 'create', username: 'x1', password: 'Pass@123', name: 'اسم' } });
  check('بحساب بلا سطر موظف: 403 ورمز no_staff_row', ghost.status === 403 && ghost.body.code === 'no_staff_row', JSON.stringify(ghost.body));

  const emp = await call({ auth: 'tok-emp', body: { action: 'create', username: 'sneaky', password: 'Pass@123', name: 'متسلل' } });
  check('بحساب موظف عادي: 403 ورمز not_admin', emp.status === 403 && emp.body.code === 'not_admin', JSON.stringify(emp.body));
  check('الموظف العادي لم يُنشئ أي مستخدم Auth', !state.authUsers.some((u) => u.email === 'sneaky@hrc-babil.com'),
    JSON.stringify(state.authUsers.map((u) => u.email)));
  check('الموظف العادي لم يُنشئ أي سطر موظف', !state.staff.some((s) => s.username === 'sneaky'));

  const empDel = await call({ auth: 'tok-emp', body: { action: 'delete', id: 'staff-admin' } });
  check('الموظف العادي لا يحذف أحداً', empDel.status === 403 && state.staff.some((s) => s.id === 'staff-admin'));

  const empPwd = await call({ auth: 'tok-emp', body: { action: 'set-password', authId: 'a-admin', password: 'Hacked@1' } });
  check('الموظف العادي لا يغيّر كلمة مرور المدير', empPwd.status === 403 &&
    state.authUsers.filter((u) => u.id === 'a-admin')[0].password === 'Admin@1234');
}

/* ===========================================================================
 *  2) إنشاء حساب موظف — المسار السعيد
 * =========================================================================== */
step(2, 'إنشاء حساب: Auth + سطر brc.staff في عملية واحدة');
{
  const state = freshState();
  await loadFunction(state);
  const r = await call({ auth: 'tok-admin', body: { action: 'create', username: 'ahmed', password: 'Ahmed@1234', name: 'أحمد محمد', role: 'staff', title: 'موظف توظيف' } });

  check('الرد: نجاح', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  const au = state.authUsers.filter((u) => u.email === 'ahmed@hrc-babil.com')[0];
  check('مستخدم Auth أُنشئ بالبريد المشتقّ', !!au, JSON.stringify(state.authUsers.map((u) => u.email)));
  const row = state.staff.filter((s) => s.username === 'ahmed')[0];
  check('سطر brc.staff أُنشئ ومرتبط بـ auth_id', !!row && row.auth_id === (au && au.id), JSON.stringify(row));
  check('الاسم والدور والمسمى كما أُدخلا', row && row.full_name === 'أحمد محمد' && row.role === 'staff' && row.job_title === 'موظف توظيف');
  check('الحساب نشط افتراضياً', row && row.active !== false);
  check('الرد يعيد السطر ليتبنّاه المتصفح', !!(r.body.staff && r.body.staff.username === 'ahmed'));
}

/* ===========================================================================
 *  3) المدخلات السيئة تُرفض قبل إنشاء أي شيء
 * =========================================================================== */
step(3, 'لا حساب يتيم: كل مدخل غير صالح يُرفض قبل الشبكة');
{
  const state = freshState();
  await loadFunction(state);
  const before = state.authUsers.length;

  const cases = [
    ['اسم مستخدم عربي', { username: 'أحمد', password: 'Pass@1234', name: 'أحمد' }, 'bad_username'],
    ['اسم مستخدم فيه مسافة', { username: 'a b', password: 'Pass@1234', name: 'أحمد' }, 'bad_username'],
    ['اسم مستخدم بحرف واحد', { username: 'a', password: 'Pass@1234', name: 'أحمد' }, 'bad_username'],
    ['كلمة مرور قصيرة', { username: 'ok1', password: '123', name: 'أحمد' }, 'weak_password'],
    ['اسم كامل فارغ', { username: 'ok2', password: 'Pass@1234', name: '' }, 'no_name']
  ];
  for (const [title, body, code] of cases) {
    const r = await call({ auth: 'tok-admin', body: Object.assign({ action: 'create' }, body) });
    check('مرفوض: ' + title + ' — الرمز ' + code, r.status === 400 && r.body.code === code, JSON.stringify(r.body));
  }
  check('لم يُنشأ أي مستخدم Auth من الخمسة المرفوضة', state.authUsers.length === before);
}

/* ===========================================================================
 *  4) اسم محجوز لموظف آخر — لا يُخطف ولا يُنشأ يتيم
 * =========================================================================== */
step(4, 'اسم مستخدم محجوز: رفض نظيف بلا آثار');
{
  const state = freshState();
  await loadFunction(state);
  const before = state.authUsers.length;

  const r = await call({ auth: 'tok-admin', body: { action: 'create', username: 'ali', password: 'New@1234', name: 'منتحل' } });
  check('مرفوض برمز username_taken', r.status === 409 && r.body.code === 'username_taken', JSON.stringify(r.body));
  check('سطر علي لم يُمَسّ (لا خطف للحساب)', state.staff.filter((s) => s.username === 'ali')[0].auth_id === 'a-emp');
  check('كلمة مرور علي لم تتغيّر', state.authUsers.filter((u) => u.id === 'a-emp')[0].password === 'Ali@1234');
  check('لم يُنشأ مستخدم Auth يتيم', state.authUsers.length === before);
}

/* ===========================================================================
 *  5) حساب نصف جاهز (Auth موجود بلا سطر) — يُصلح ولا يُغلق
 * =========================================================================== */
step(5, 'إصلاح ذاتي: مستخدم Auth موجود بلا سطر موظف');
{
  const state = freshState();
  state.authUsers.push({ id: 'a-orphan', email: 'sara@hrc-babil.com', password: 'old-but-unusable' });
  await loadFunction(state);

  const r = await call({ auth: 'tok-admin', body: { action: 'create', username: 'sara', password: 'Sara@1234', name: 'سارة علي', role: 'staff' } });
  check('الإنشاء نجح بدل «البريد مسجّل مسبقاً»', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
  check('الربط بمستخدم Auth القديم نفسه (لا نسخة ثانية)', r.body.authId === 'a-orphan', JSON.stringify(r.body));
  check('كلمة المرور ضُبطت على ما أعطاه المدير',
    state.authUsers.filter((u) => u.id === 'a-orphan')[0].password === 'Sara@1234');
  check('سطر الموظف أُنشئ ومرتبط', state.staff.filter((s) => s.username === 'sara')[0].auth_id === 'a-orphan');
  check('وُسم الرد بأنه إصلاح (repaired)', r.body.repaired === true);
  check('لم يُنشأ مستخدم Auth مكرر', state.authUsers.filter((u) => u.email === 'sara@hrc-babil.com').length === 1);
}

/* ===========================================================================
 *  6) التعديل — وحماية المدير من قفل نفسه
 * =========================================================================== */
step(6, 'التعديل: أدوار وتنشيط، وحماية سطر المدير نفسه');
{
  const state = freshState();
  await loadFunction(state);

  const r1 = await call({ auth: 'tok-admin', body: { action: 'update', id: 'staff-emp', name: 'علي حسن', role: 'admin', title: 'مشرف', active: false } });
  check('تعديل موظف: نجح', r1.status === 200 && r1.body.ok === true, JSON.stringify(r1.body));
  const emp = state.staff.filter((s) => s.id === 'staff-emp')[0];
  check('السطر حمل القيم الجديدة', emp.full_name === 'علي حسن' && emp.role === 'admin' && emp.active === false, JSON.stringify(emp));

  const r2 = await call({ auth: 'tok-admin', body: { action: 'update', id: 'staff-admin', name: 'حسين', role: 'staff', active: false } });
  check('تعديل سطره: مسموح للاسم فقط', r2.status === 200 && r2.body.selfLimited === true, JSON.stringify(r2.body));
  const me = state.staff.filter((s) => s.id === 'staff-admin')[0];
  check('دوره لم يُخفَّض إلى موظف', me.role === 'admin', JSON.stringify(me));
  check('لم يُعطّل نفسه (لا قفل للنظام)', me.active !== false);
  check('اسمه تحدّث', me.full_name === 'حسين');
}

/* ===========================================================================
 *  7) الحذف — السطر ومستخدم الدخول معاً، ولا يمسّ المدير نفسه
 * =========================================================================== */
step(7, 'الحذف: إزالة كاملة وحماية الحساب الحالي');
{
  const state = freshState();
  await loadFunction(state);

  const self = await call({ auth: 'tok-admin', body: { action: 'delete', id: 'staff-admin' } });
  check('المدير لا يحذف حسابه: 400 self_delete', self.status === 400 && self.body.code === 'self_delete', JSON.stringify(self.body));
  check('سطره ما زال موجوداً', state.staff.some((s) => s.id === 'staff-admin'));

  const del = await call({ auth: 'tok-admin', body: { action: 'delete', id: 'staff-emp', authId: 'a-emp' } });
  check('حذف موظف: نجح', del.status === 200 && del.body.ok === true, JSON.stringify(del.body));
  check('سطر الموظف حُذف', !state.staff.some((s) => s.id === 'staff-emp'));
  check('مستخدم الدخول حُذف من Auth', !state.authUsers.some((u) => u.id === 'a-emp'));
}

/* ===========================================================================
 *  8) كلمة المرور والإجراءات الثانوية
 * =========================================================================== */
step(8, 'كلمة المرور، whoami، والطلبات غير الصحيحة');
{
  const state = freshState();
  await loadFunction(state);

  const short = await call({ auth: 'tok-admin', body: { action: 'set-password', authId: 'a-emp', password: '123' } });
  check('كلمة مرور قصيرة: 400 weak_password', short.status === 400 && short.body.code === 'weak_password');

  const pwd = await call({ auth: 'tok-admin', body: { action: 'set-password', authId: 'a-emp', password: 'Ali@9999' } });
  check('تغيير كلمة المرور: نجح', pwd.status === 200 && pwd.body.ok === true);
  check('كلمة المرور تغيّرت فعلاً في Auth', state.authUsers.filter((u) => u.id === 'a-emp')[0].password === 'Ali@9999');

  const who = await call({ auth: 'tok-admin', body: { action: 'whoami' } });
  check('whoami يعيد صف المدير', who.status === 200 && who.body.staff.username === 'hussein');

  const bogus = await call({ auth: 'tok-admin', body: { action: 'destroy-everything' } });
  check('إجراء غير معروف: 400 ورمز bad_action', bogus.status === 400 && bogus.body.code === 'bad_action');

  const getReq = await call({ auth: 'tok-admin', method: 'GET' });
  check('طلب غير POST: 405', getReq.status === 405, String(getReq.status));

  const preflight = await handler(new Request('https://fn.local/x', { method: 'OPTIONS' }));
  check('طلب OPTIONS (CORS) يُجاب بلا لمس المنطق', preflight.status === 200);
  check('ترويسات CORS حاضرة', !!preflight.headers.get('Access-Control-Allow-Origin'));
}

/* ===========================================================================
 *  9) الإعداد الناقص لا يفتح الباب
 * =========================================================================== */
step(9, 'بلا إعداد في البيئة: 500 صريح ولا تنفيذ');
{
  const state = freshState();
  await loadFunction(state, { SUPABASE_SERVICE_ROLE_KEY: '' });
  const r = await call({ auth: 'tok-admin', body: { action: 'create', username: 'zz', password: 'Pass@1234', name: 'اسم' } });
  check('500 not_configured', r.status === 500 && r.body.code === 'not_configured', JSON.stringify(r.body));
  check('لم يُنشأ شيء', !state.staff.some((s) => s.username === 'zz'));
}

/* ---------------------------------- الخلاصة ---------------------------------- */
try { rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
