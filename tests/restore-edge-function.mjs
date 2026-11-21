/* ═══════════════════════════════════════════════════════════════════════════
   HRC — اختبار دالة الاسترجاع السحابية (supabase/functions/hrc-restore)

   الفكرة: أهمّ ما في تلك الدالة أنها **تقرّر** — بماذا ترفض، وكيف تقطّع الملف،
   وكيف تتحقّق. ولا يصحّ أن نختبر نسخة من المنطق مكتوبة هنا: لو انحرفت
   النسختان لصار الاختبار شهادة زور. لذلك نستخرج المنطق من ملف الدالة نفسه
   بين علامتَي `@inline:begin/end`، ونستورد `handle` من الملف مباشرةً
   (Node 22 يُجرّد أنواع TypeScript بنفسه).

   ما يُثبَت هنا:
     ١) المقطِّع داخل الدالة يطابق tools/sql-split-core.mjs عبارةً بعبارة.
     ٢) قارئ الترويسة يطابق tools/dump-header.mjs رقماً برقم.
     ٣) الحراسة: بلا رمز، رمز خاطئ، مشروع الإنتاج، بلا confirm، قاعدة غير فارغة.
     ٤) التجربة الجافّة لا تكتب حرفاً واحداً.
     ٥) استرجاع كامل لملف حقيقي على PostgreSQL 17 (PGlite) → PASS وكل الأعداد،
        ثم ضبط مفتاح البصمة عبر جسم POST → طول 64.
     ٦) ملفات مرفوضة: قديم بـTRIGGER ALL، وملف ليس استرجاع HRC.

   التشغيل: node tests/restore-edge-function.mjs
            HRC_DUMP=/path/HRC-FULL.sql node tests/restore-edge-function.mjs
   (القسم ٥ يُتخطّى إن لم يوجد ملف بيانات — فهو بيانات شخصية خارج Git.)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { splitStatements as coreSplit } from '../tools/sql-split-core.mjs';
import { headerCounts as coreHeader } from '../tools/dump-header.mjs';
import { SHIM } from './pg-shim.mjs';
import { handle } from '../supabase/functions/hrc-restore/index.ts';

let ok = 0, bad = 0;
const check = (label, cond, extra = '') => {
  cond ? ok++ : bad++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (cond ? '' : ` — ${extra}`));
};

const SRC = readFileSync(new URL('../supabase/functions/hrc-restore/index.ts', import.meta.url), 'utf8');

/* ── استخراج المنطق من الملف المنشور نفسه ───────────────────────────────── */
function inline(name) {
  const re = new RegExp(`/\\* @inline:begin ${name} \\*/([\\s\\S]*?)/\\* @inline:end ${name} \\*/`);
  const m = re.exec(SRC);
  if (!m) throw new Error(`المنطقة @inline:${name} غائبة من ملف الدالة`);
  return m[1];
}
const splitStatements = new Function(inline('splitStatements') + '\nreturn splitStatements;')();
const headerCounts = new Function(inline('headerCounts') + '\nreturn headerCounts;')();

/* ── بيئة وهمية للحراسة ─────────────────────────────────────────────────── */
const TOKEN = 'test-token-0123456789';
const PROD_ENV = {
  RESTORE_TOKEN: TOKEN,
  SUPABASE_URL: 'https://vqsvztudvfukyuerzcgx.supabase.co',
  SUPABASE_DB_URL: 'postgres://postgres.x:pw@db.vqsvztudvfukyuerzcgx.supabase.co:5432/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-stub',
};
const NEW_ENV = {
  RESTORE_TOKEN: TOKEN,
  SUPABASE_URL: 'https://newrefnewref.supabase.co',
  SUPABASE_DB_URL: 'postgres://postgres.newref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-stub',
};
const envOf = (o) => (k) => (k in o ? o[k] : null);

const DUMP_TEXT = `--  HRC — ملف كامل: الهيكل + البيانات
--  الأعداد : 3 staff · 726 applicants · 22 jobs
--            عدّاد البطاقات: 176
create table if not exists brc.staff (id int);
select 1;
`;
const enc = new TextEncoder();

/* fetch وهمي: يعيد قائمة الوعاء ثم الملف نفسه — كما تفعل Storage تماماً */
function stubFetch({ files, body = DUMP_TEXT, status = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (String(url).includes('/object/list/')) {
      return new Response(JSON.stringify((files || []).map((n) => ({ name: n }))), { status: 200 });
    }
    if (String(url).includes('/storage/v1/object/')) {
      return new Response(status === 200 ? enc.encode(body) : 'boom', { status });
    }
    return new Response('not found', { status: 404 });
  };
  f.calls = calls;
  return f;
}

/* سائق وهمي: يعدّ العبارات ويُجيب عن استعلامات العدّ من أرقام جاهزة */
function fakeDriver(state = {}) {
  const runs = [];
  const tables = state.tables || {};
  return {
    runs,
    async run(s) { runs.push(s); },
    async runWith(s) { runs.push(s); },
    async query(s) {
      const m = /from brc\.([a-z_]+)/.exec(s);
      if (/pg_trigger/.test(s)) return [{ n: state.disabled ?? 0 }];
      if (/app_secrets/.test(s)) return [{ n: state.secretSet ? 1 : 0 }];
      if (/card_number_counter/.test(s)) return [{ n: state.counter ?? 0 }];
      if (/verify_token/.test(s)) return [{ n: state.verifyLen ?? null }];
      if (m) return [{ n: tables[m[1]] ?? 0 }];
      return [{ n: 0 }];
    },
    async end() {},
  };
}

const call = async (qs, { env = NEW_ENV, fetchImpl, driver, method = 'GET', body } = {}) => {
  const req = new Request(`https://newrefnewref.supabase.co/functions/v1/hrc-restore${qs}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  const res = await handle(req, {
    env: envOf(env),
    fetchImpl: fetchImpl || stubFetch({ files: ['HRC-FULL-2026-11-21.sql'] }),
    connect: async () => driver || fakeDriver({ tables: { applicants: 0 } }),
  });
  return { status: res.status, json: await res.json() };
};

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('═══ ١) المقطِّع وقارئ الترويسة: نسخة الدالة = نسخة الأدوات ═══');

/* حالة صعبة: نصوص فيها ';' · تعليقات · كتل $$ و$tag$ · عربية */
const FIXTURE = `-- تعليقة فيها ; لا تُقطع
create table t (a text default 'x;y', b text default 'it''s; ok');
/* كتلة ; داخلها
   ; ونهايتها */
create or replace function f() returns trigger language plpgsql as $$
begin
  insert into t values ('a;b');
  return new;
end $$;
create or replace function g() returns int language plpgsql as $tag$
begin
  return 1;  -- ; هنا
end
$tag$;
insert into t values ('عربي؛ بفاصلة عربية');
select "عمود;غريب" from t;
`;
const a = coreSplit(FIXTURE), b = splitStatements(FIXTURE);
check(`تقسيم حالة صعبة: ${a.length} عبارة`, a.length === b.length, `الأدوات ${a.length} · الدالة ${b.length}`);
check('التقسيم متطابق حرفاً بحرف', JSON.stringify(a) === JSON.stringify(b), 'يوجد اختلاف');
check('أجسام $$ سليمة (لم تُقطع)', b.filter((s) => /\$\$/.test(s)).length === 1, 'كتلة $$ قُسمت');
check('$tag$ سليم', b.some((s) => /\$tag\$/.test(s) && /return 1/.test(s)), 'كتلة $tag$ قُسمت');

const HDR = '--  الأعداد : 3 staff · 726 applicants · 0 office_receipts\n--            عدّاد البطاقات: 176\n';
check('ترويسة: تقرأ كل الأعداد', JSON.stringify(headerCounts(HDR)) === JSON.stringify(coreHeader(HDR)), JSON.stringify(headerCounts(HDR)));
check('ترويسة بلا سطر الأعداد ⇒ null', headerCounts('-- لا شيء') === null);

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n═══ ٢) الحراسة: متى ترفض الدالة؟ ═══');

let r = await call(`?key=${TOKEN}&confirm=RESTORE`, { env: { ...NEW_ENV, RESTORE_TOKEN: '' } });
check('بلا RESTORE_TOKEN مضبوط ⇒ 500 ورسالة عربية', r.status === 500 && /RESTORE_TOKEN/.test(r.json.message), JSON.stringify(r.json).slice(0, 120));

r = await call(`?key=wrong-key-999999&confirm=RESTORE`);
check('رمز خاطئ ⇒ 401', r.status === 401, r.status);

r = await call(`?key=${TOKEN}&confirm=RESTORE`, { env: PROD_ENV });
check('مشروع الإنتاج ⇒ 403 مهما كان الرمز صحيحاً', r.status === 403 && /الإنتاج/.test(r.json.message), r.status);

r = await call(`?key=${TOKEN}`);
check('بلا confirm=RESTORE ⇒ 400 ولا تنفيذ', r.status === 400 && /confirm/.test(r.json.message), r.status);

r = await call(`?key=${TOKEN}&confirm=RESTORE`, { driver: fakeDriver({ tables: { applicants: 726 } }) });
check('قاعدة غير فارغة بلا force ⇒ 409', r.status === 409 && /726/.test(r.json.message), r.status);

r = await call(`?key=${TOKEN}&confirm=RESTORE`, {
  fetchImpl: stubFetch({ files: ['HRC-FULL-2026-11-21.sql'], body: 'ALTER TABLE brc.x DISABLE TRIGGER ALL;\ncreate table if not exists brc.staff();' }),
});
check('ملف قديم بـTRIGGER ALL ⇒ 400', r.status === 400 && /TRIGGER ALL/.test(r.json.message), r.json.message);

r = await call(`?key=${TOKEN}&confirm=RESTORE`, { fetchImpl: stubFetch({ files: ['x.sql'], body: 'select 1;' }) });
check('ملف ليس استرجاع HRC ⇒ 400', r.status === 400 && /HRC/.test(r.json.message), r.json.message);

r = await call(`?key=${TOKEN}`, { fetchImpl: stubFetch({ files: ['a.sql', 'b.sql'] }) });
check('وعاء فيه ملفان بلا تحديد ⇒ 400 يسمّيهما', r.status === 400 && /a\.sql/.test(r.json.message) && /b\.sql/.test(r.json.message), r.json.message);

r = await call(`?key=${TOKEN}`, { fetchImpl: stubFetch({ files: [], status: 400 }) });
check('وعاء فارغ ⇒ 400 مفهوم', r.status === 400 && /\.sql/.test(r.json.message), r.json.message);

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n═══ ٣) التجربة الجافّة لا تكتب شيئاً ═══');

const dryDriver = fakeDriver({ tables: { applicants: 0 } });
r = await call(`?key=${TOKEN}&dry=1`, { driver: dryDriver });
check('dry ⇒ 200 وverdict READY', r.status === 200 && r.json.verdict === 'READY', JSON.stringify(r.json).slice(0, 120));
check('dry ⇒ صفر عبارات منفَّذة', dryDriver.runs.length === 0, `نُفِّذت ${dryDriver.runs.length}`);
check('dry ⇒ يعدّ العبارات ويقرأ البصمة', r.json.statements === 2 && /^[0-9a-f]{64}$/.test(r.json.sha256), JSON.stringify({ s: r.json.statements, sha: r.json.sha256 }));
check('dry ⇒ يقرأ الأعداد المتوقّعة من الترويسة', r.json.willRun.expected.applicants === 726 && r.json.willRun.expected.counter === 176);

const dryFull = fakeDriver({ tables: { applicants: 726 } });
r = await call(`?key=${TOKEN}&dry=1`, { driver: dryFull });
check('dry على قاعدة ممتلئة ⇒ needsForce=true', r.json.needsForce === true && dryFull.runs.length === 0, JSON.stringify(r.json).slice(0, 120));

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n═══ ٤) استرجاع حقيقي على PostgreSQL 17 (PGlite) ═══');

const dumpPath = [
  process.env.HRC_DUMP,
  ...readdirSync('.').filter((f) => /^HRC-FULL-.*\.sql$/.test(f)),
  'tests/.tmp/HRC-FULL-2026-11-21.sql',
].filter(Boolean).find((p) => existsSync(p));

if (!dumpPath) {
  console.log('  ⚠️ تخطٍّ: لا ملف بيانات (HRC-FULL-*.sql) — القسم ٤ يحتاج نسخة حقيقية.');
} else {
  const dumpText = readFileSync(dumpPath, 'utf8');
  const dumpBytes = readFileSync(dumpPath);

  /* نفس ما يفعله الملف: يقارن العدد المتوقّع من الترويسة بالواقع */
  const expectHeader = coreHeader(dumpText);

  /* PGlite + مخطط الإنتاج المصغّر + بديل hmac (pgcrypto غير متاح في PGlite) */
  const db = new PGlite();
  await db.exec(SHIM);
  await db.exec(`create or replace function extensions.hmac(text, text, text) returns bytea
                 language sql immutable as $f$ select decode(md5($1 || $2) || md5($2 || $1), 'hex') $f$;`);

  const pgliteDriver = () => ({
    runs: 0,
    async run(s) { await db.exec(s); this.runs++; },
    async runWith(s, p) { await db.query(s, p); this.runs++; },
    async query(s) { return (await db.query(s)).rows; },
    async end() {},
  });
  const dgl = pgliteDriver();
  const fFetch = stubFetch({ files: [] });
  /* نُبدّل الردّ ليعيد بايتات الملف كما هي */
  const realFetch = async (url, init = {}) => {
    if (String(url).includes('/object/list/')) return new Response(JSON.stringify([{ name: 'HRC-FULL-test.sql' }]), { status: 200 });
    return new Response(dumpBytes, { status: 200 });
  };

  const t0 = Date.now();
  r = await call(`?key=${TOKEN}&confirm=RESTORE`, {
    fetchImpl: realFetch,
    driver: dgl,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  check(`استرجاع الملف الكامل بلا خطأ (${dgl.runs} عبارة · ${secs} ثانية)`, r.status === 200, `${r.status} — ${String(r.json.message).slice(0, 200)}`);
  check('verdict = PASS', r.json.verdict === 'PASS', JSON.stringify(r.json.failedChecks));
  const tableChecks = (r.json.checks || []).filter((c) => c.name !== 'counter' && c.name !== 'disabled_triggers');
  check(`كل أعداد الجداول تطابق الترويسة (${tableChecks.length} جدولاً)`, tableChecks.length > 0 && tableChecks.every((c) => c.ok), JSON.stringify(tableChecks.filter((c) => !c.ok)));
  check('عدّاد البطاقات = ترويسة الملف', r.json.checks.find((c) => c.name === 'counter' )?.ok === true, JSON.stringify(r.json.checks.find((c) => c.name === 'counter')));
  check('لا مشغّل متروكاً معطّلاً', r.json.checks.find((c) => c.name === 'disabled_triggers')?.actual === 0, 'توجد مشغّلات معطّلة');
  check('مفتاح البصمة غائب ⇒ يُصرّح به بصدق ولا يدّعي النجاح', r.json.appSecret.state === 'missing' && r.json.appSecret.ok === false, JSON.stringify(r.json.appSecret));
  check('الأعداد الفعلية تساوي أعداد الإنتاج في الترويسة', (() => {
    const t = r.json.after.tables;
    return Object.keys(expectHeader).filter((k) => k !== 'counter').every((k) => t[k] === expectHeader[k]);
  })(), JSON.stringify(r.json.after.tables));

  /* إعادة التنفيذ على قاعدة ممتلئة: بلا force ⇒ 409 */
  r = await call(`?key=${TOKEN}&confirm=RESTORE`, { fetchImpl: realFetch, driver: pgliteDriver() });
  check('إعادة بلا force ⇒ 409 (حماية من المحو بالخطأ)', r.status === 409, `${r.status}`);

  /* وبـforce وحدها: المخطط موجود بشكل مختلف ⇒ فشل واضح يقود إلى reset=YES.
     (هذا سلوك PostgreSQL نفسه لا PGlite: create or replace view لا يغيّر أعمدة) */
  r = await call(`?key=${TOKEN}&confirm=RESTORE&force=YES`, { fetchImpl: realFetch, driver: pgliteDriver() });
  check('إعادة بـforce وحدها ⇒ فشل صريح في المرحلة ١ يُشخَّص', r.status === 500 && r.json.schemaDrift === true, `${r.status} ${r.json.pgCode}`);
  check('رسالة الفشل تدلّ على &reset=YES', /reset=YES/.test(r.json.message), String(r.json.message).slice(-120));

  r = await call(`?key=${TOKEN}&confirm=RESTORE&reset=YES`, { fetchImpl: realFetch, driver: pgliteDriver() });
  check('reset=YES بلا force ⇒ مرفوض (لا محو بلا تصريح)', r.status !== 200 && /force/i.test(r.json.message), `${r.status} ${r.json.message}`);

  /* وبـforce+reset: إعادة بناء كاملة ⇒ PASS ومفتاح 64 */
  const dgl2 = pgliteDriver();
  r = await call(`?key=${TOKEN}`, {
    method: 'POST',
    body: { confirm: 'RESTORE', key: TOKEN, force: 'YES', reset: 'YES', brcSecret: 'k'.repeat(32) },
    fetchImpl: realFetch,
    driver: dgl2,
  });
  check('إعادة بـforce+reset ⇒ PASS (يمكن تحديث نسخة قائمة)', r.status === 200 && r.json.verdict === 'PASS', `${r.status} ${String(r.json.message).slice(0, 160)}`);
  check('تمرير brcSecret في جسم POST ⇒ set-now', r.json.appSecret.state === 'set-now', JSON.stringify(r.json.appSecret));
  check('بعد ضبط المفتاح: طول verify_token = 64', r.json.appSecret.verifyTokenLength === 64, String(r.json.appSecret.verifyTokenLength));
  check('الردّ يعطي الخطوات التالية بالعربية', Array.isArray(r.json.next) && r.json.next.length >= 4 && /Exposed schemas/.test(r.json.next.join(' ')), JSON.stringify(r.json.next));

  /* لا يُسرَّب السرّ في الردّ */
  check('الردّ لا يحوي قيمة السرّ نفسها', !JSON.stringify(r.json).includes('kkkkkkkkkkkkkkkk'), 'تسرّب السرّ');

  await db.close();
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — دالة الاسترجاع السحابية تعمل كما يُدّعى` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
