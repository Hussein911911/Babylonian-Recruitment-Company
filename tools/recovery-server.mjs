#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — «استرجاع بضغطة» · خادم محلي على جهاز المكتب

   ⚠️ المشكلة التي يحلّها هذا الملف

   بعد الكارثة (مشروع Supabase محذوف/معطّل) يحتاج المدير أن يعيد بناء القاعدة
   من ملف `HRC-FULL.sql`. الطريقان المتاحان كانا:
     • لصق ٢٠٥٠٠ سطر في محرّر Supabase ← يقصّ عند ~٢٠٠٠ سطر ويقول Success.
     • `psql` من الطرفية ← المالك رفض الطرفية صراحةً.
   وكلاهما يفشل في أسوأ لحظة ممكنة.

   فهذا الخادم يُشغَّل **بضغطة على أيقونة** (لا طرفية)، ويفتح صفحة واحدة فيها:
     المشروع القديم، المشروع الجديد، زر «استرجع الآن»، وشاشة نتائج بالأعداد.

   ═══ لماذا خادم محلي ولا صفحة في المتصفح؟ ═══
   لأن المتصفح **لا يستطيع** الاتصال بقاعدة PostgreSQL مباشرة: لا مقبس TCP
   خام فيه. وأي حل يمرّر الاسترجاع عبر Cloudflare/Supabase Edge يواجه حاجزين
   حقيقيين: حجم الطلب (١.٨ م.ب) والمهلة. فالخادم المحلي هو الطريق الذي يعمل
   فعلاً وفي كل الظروف — حتى لو كان الموقع نفسه معطّلاً.

   ═══ التشغيل ═══
     ١) وندوز: انقر مزدوجاً على `START-RECOVERY.bat` في مجلد الأداة.
     ٢) أو:  node tools/recovery-server.mjs
   ثم يفتح المتصفح تلقائياً على الصفحة.

   ═══ الأمان ═══
   • يستمع على 127.0.0.1 فقط — لا يصل إليه أحد من الشبكة.
   • توكن جلسة عشوائي في رابط الصفحة؛ كل طلب بلا التوكن يُرفض (403).
   • لا يُخزَّن رابط القاعدة ولا كلمة مرورها في أي ملف: تبقى في ذاكرة العملية.
   • لا يُنفّذ على قاعدة فيها بيانات إلا بكتابة عبارة تأكيد صريحة.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDump, inspectTarget, EXPECTED_TABLES } from './recovery-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = randomBytes(18).toString('hex');
const PORT = Number(process.env.HRC_RECOVERY_PORT || 0) || 7311;

/* ⚠️ الحد الأقصى لحمولة الملف: ملف كامل بصور مضمّنة قد يبلغ عشرات الميغابايت.
   نسمح بـ64 م.ب ونرفض ما فوقه صراحةً بدل أن نُسقط الطلب بصمت. */
const MAX_BODY = 64 * 1024 * 1024;

/* آخر نتيجة استرجاع — للعرض في الصفحة. في الذاكرة فقط. */
let lastRun = null;

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function body(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('الحمولة أكبر من الحد المسموح (64 م.ب).');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* ═══ منفّذ SQL عبر سائق `pg` ═══════════════════════════════════════════════
   ⚠️ نستورد `pg` عند الطلب لا في الأعلى: الأداة يجب أن تفتح وتشرح نفسها
   حتى لو لم تُثبَّت الحزمة بعد. فالمستخدم يرى رسالة مفهومة بدل انهيار. */
async function makeRunner(connString) {
  let pg;
  try { pg = (await import('pg')).default; }
  catch (e) {
    throw new Error('حزمة `pg` غير مثبّتة. شغّل `npm install` مرة واحدة ثم أعد المحاولة.');
  }
  const client = new pg.Client({
    connectionString: connString,
    ssl: /supabase\.(co|com)/.test(connString) ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 0,
    query_timeout: 0
  });
  await client.connect();
  const runner = (sql) => client.query(sql);
  runner.close = () => client.end().catch(() => {});
  return runner;
}

function page(html) {
  return html.replaceAll('__HRC_TOKEN__', TOKEN);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);

  /* كل طلب يجب أن يحمل توكن الجلسة — الصفحة نفسها تحمله في مسارها */
  const given = url.searchParams.get('t') || req.headers['x-hrc-token'];
  if (given !== TOKEN) return json(res, 403, { ok: false, error: 'توكن الجلسة غير صالح — افتح الصفحة من الرابط الذي طُبع في النافذة.' });

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = page(await readFile(join(ROOT, 'tools', 'recovery-app.html'), 'utf8'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (url.pathname === '/api/env' && req.method === 'GET') {
      let pgOk = false, pgliteOk = false;
      try { await import('pg'); pgOk = true; } catch (e) {}
      try { await import('@electric-sql/pglite'); pgliteOk = true; } catch (e) {}
      return json(res, 200, {
        ok: true, pg: pgOk, pglite: pgliteOk, expectedTables: EXPECTED_TABLES,
        lastRun: lastRun && { at: lastRun.at, counts: lastRun.counts, failed: lastRun.failed }
      });
    }

    /* فحص القاعدة الهدف قبل أي مسح — «لا نظهر تأكيداً بلا معرفة» */
    if (url.pathname === '/api/inspect' && req.method === 'POST') {
      const { connectionString } = JSON.parse(await body(req));
      if (!connectionString) return json(res, 400, { ok: false, error: 'رابط القاعدة مطلوب.' });
      let runner;
      try {
        runner = await makeRunner(connectionString);
        const info = await inspectTarget(runner);
        return json(res, 200, { ok: true, ...info });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      } finally {
        if (runner && runner.close) await runner.close();
      }
    }

    if (url.pathname === '/api/restore' && req.method === 'POST') {
      const payload = JSON.parse(await body(req));
      const { connectionString, sql, confirm } = payload;
      if (!connectionString) return json(res, 400, { ok: false, error: 'رابط القاعدة مطلوب.' });
      if (!sql || sql.length < 1000) return json(res, 400, { ok: false, error: 'الملف غير محمّل أو فارغ.' });
      if (String(confirm || '').trim() !== 'استرجع') {
        return json(res, 400, { ok: false, error: 'تحتاج كتابة كلمة التأكيد «استرجع» حرفياً قبل التنفيذ.' });
      }
      let runner;
      try {
        runner = await makeRunner(connectionString);
        const before = await inspectTarget(runner);
        /* ⚠️ لا نُنفّذ على هدف لا يشبه مشروع Supabase: الملف يعتمد على
           auth.uid()/auth.jwt() وسكيما extensions. التنفيذ على PostgreSQL
           عادي يفشل في منتصف الطريق ويترك قاعدة مشوّهة. نوقف قبل أول جملة. */
        if (!before.looksLikeSupabase) {
          return json(res, 200, { ok: false, error: 'الرابط لا يبدو مشروع Supabase (ناقص auth/extensions). تأكد أنه رابط Direct connection للمشروع الجديد.', before, report: null });
        }
        const report = await executeDump({ run: runner, query: runner, sql });
        lastRun = { at: new Date().toISOString(), counts: report.counts, failed: report.failed, before };
        return json(res, 200, { ok: !report.failed, before, report });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      } finally {
        if (runner && runner.close) await runner.close();
      }
    }

    /* استرجاع تجريبي على قاعدة داخلية (PGlite) — للتحقق من الملف بلا لمس أي
       قاعدة حقيقية. المالك يستطيع أن «يجرّب» قبل أن ينفّذ. */
    if (url.pathname === '/api/dryrun' && req.method === 'POST') {
      const { sql } = JSON.parse(await body(req));
      if (!sql || sql.length < 1000) return json(res, 400, { ok: false, error: 'الملف غير محمّل أو فارغ.' });
      let PGlite, pgcrypto;
      try {
        ({ PGlite } = await import('@electric-sql/pglite'));
        ({ pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto'));
      } catch (e) { return json(res, 200, { ok: false, error: 'PGlite غير مثبّت — التجربة الداخلية غير متاحة (لا يمنع الاسترجاع الحقيقي).' }); }
      /* ⚠️ pgcrypto لازمة فعلاً: برنامج البطاقات يستعمل extensions.gen_random_bytes
         لتوليد أكواد عشوائية. بدونها تتوقف التجربة عند أول دالة — وهذا فشل
         «نظيف» لكنه لا يثبت أن الملف سليم. تُحمَّل هنا كما تُفعَّل على Supabase. */
      const db = await PGlite.create({ extensions: { pgcrypto } });
      try {
        /* محاكاة الحد الأدنى من بيئة Supabase: الأدوار وما تعتمده المخططات */
        await db.exec(`
          do $$ begin
            if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
            if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
            if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
          end $$;
          create schema if not exists extensions;
          create schema if not exists auth;
          create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now());
          create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
          create table if not exists auth.refresh_tokens (id bigserial primary key, token text, user_id uuid, session_id uuid, revoked boolean default false);
          create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
          create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
        `);
        const report = await executeDump({ run: (s) => db.exec(s), query: (s) => db.query(s), sql });
        return json(res, 200, { ok: !report.failed, report });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      } finally {
        await db.close().catch(() => {});
      }
    }

    return json(res, 404, { ok: false, error: 'مسار غير معروف.' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
});

const href = 'http://127.0.0.1:' + PORT + '/?t=' + TOKEN;
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('   أداة استرجاع قاعدة الشركة — تعمل الآن على جهازك');
  console.log('');
  console.log('   افتح هذا الرابط في المتصفح:');
  console.log('   ' + href);
  console.log('');
  console.log('   ⚠️ لا تُغلق هذه النافذة قبل انتهاء الاسترجاع.');
  console.log('   للإغلاق: أغلق النافذة.');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('');
  /* نفتح المتصفح تلقائياً — «بضغطة» تعني بضغطة فعلاً */
  const cmd = process.platform === 'win32' ? 'start "" "' + href + '"'
    : process.platform === 'darwin' ? 'open "' + href + '"'
    : 'xdg-open "' + href + '"';
  exec(cmd, () => {});
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('\n  ❌ المنفذ ' + PORT + ' مستعمل. أغلق النسخة الأخرى أو شغّل:');
    console.error('     HRC_RECOVERY_PORT=7312 node tools/recovery-server.mjs\n');
    process.exit(1);
  }
  throw e;
});
