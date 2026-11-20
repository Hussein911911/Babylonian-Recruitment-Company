#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   اختبار بديل `app.brc_secret` — جدول brc.app_secrets
   ---------------------------------------------------------------------------
   السبب: ضبط `app.brc_secret` يحتاج superuser، ودور postgres في Supabase
   الحديث ليس superuser (‏42501). فصار للبصمة مصدر ثانٍ داخل القاعدة.

   هذا الاختبار ساكن (بلا قاعدة وبلا شبكة) ويُثبت:
     • الجدول معرّف في المخطط مع RLS وبلا أي سياسة، وممنوع على كل أدوار API.
     • `verify_token` تقرأ الإعداد أولاً ثم الجدول (سلوك الإنتاج محفوظ).
     • لا سرّ مكتوب في أي من الملفين.
     • نسخة الإصلاح 04 ونسخة المخطط متطابقتان (لا انحراف).
   ═══════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SCHEMA = readFileSync(new URL('../docs/schema.sql', import.meta.url), 'utf8');
const FIX = readFileSync(new URL('../docs/sql-parts/fixes/04-brc-secret-fallback.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../supabase/migrations/20260915000000_brc_initial_schema.sql', import.meta.url), 'utf8');

/* إزالة التعليقات قبل فحص «لا سرّ مكتوب»: التوثيق يجوز أن يذكر صيغة الإسناد
   بقيمة بديلة، والممنوع هو الإسناد الفعلي في كود SQL. */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log(`  ✔ ${name}`); };

/* يستخرج جسم دالة verify_token من نص SQL (من create… إلى $$; الأخيرة) */
function tokenFn(text) {
  const start = text.indexOf('create or replace function brc.verify_token');
  assert.ok(start >= 0, 'verify_token غير موجودة');
  const bodyStart = text.indexOf('as $$', start);
  const end = text.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > 0 && end > bodyStart, 'جسم verify_token غير مكتمل');
  return text.slice(start, end + 3);
}

console.log('اختبار بديل app.brc_secret:');

ok('جدول brc.app_secrets معرّف في المخطط ومزامن مع ملف الـmigration', () => {
  for (const [name, text] of [['docs/schema.sql', SCHEMA], ['migration', MIGRATION]]) {
    assert.match(text, /create table if not exists brc\.app_secrets/i, `${name}: الجدول غائب`);
    assert.match(text, /alter table brc\.app_secrets enable row level security/i, `${name}: RLS غير مفعّلة`);
  }
  /* المزامنة الحرفية بين المصدر والـmigration */
  assert.equal(MIGRATION.includes('brc.app_secrets'), SCHEMA.includes('brc.app_secrets'));
});

ok('الجدول ممنوع على كل أدوار API (revoke صريح)', () => {
  const line = (FIX.match(/revoke all on brc\.app_secrets[^;]*;/i) || [''])[0].toLowerCase();
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.ok(line.includes(role), `REVOKE يفتقد الدور ${role} — «${line}»`);
  }
});

ok('لا سياسة على الجدول (RLS بلا policy = منع كامل)', () => {
  const after = SCHEMA.slice(SCHEMA.indexOf('create table if not exists brc.app_secrets'));
  const window = after.slice(0, 1200);
  assert.ok(!/create policy[^;]*app_secrets/i.test(window), 'يوجد policy على جدول الأسرار');
});

ok('verify_token: الإعداد أولاً ثم الجدول، وتظل ترفض بلا مفتاح', () => {
  for (const [name, text] of [['schema', SCHEMA], ['fix 04', FIX]]) {
    const fn = tokenFn(text);
    assert.match(fn, /current_setting\('app\.brc_secret',\s*true\)/, `${name}: لا تقرأ الإعداد`);
    assert.match(fn, /from brc\.app_secrets/i, `${name}: لا تقرأ الجدول`);
    const gucAt = fn.indexOf("current_setting('app.brc_secret'");
    const tableAt = fn.toLowerCase().indexOf('from brc.app_secrets');
    assert.ok(gucAt < tableAt, `${name}: ترتيب الأولوية معكوس (الإعداد يجب أن يسبق الجدول)`);
    assert.match(fn, /raise\s+exception/i, `${name}: لا ترفض العمل بلا مفتاح`);
    assert.match(fn.slice(0, 1200), /set\s+search_path\s*=\s*brc,\s*public,\s*extensions/i, `${name}: search_path ناقص extensions`);
  }
});

ok('نسخة الدالة متطابقة بين المخطط والإصلاح 04', () => {
  const a = tokenFn(SCHEMA).replace(/\s+/g, ' ').trim();
  const b = tokenFn(FIX).replace(/\s+/g, ' ').trim();
  assert.equal(a, b, 'الدالتان مختلفتان — انحراف بين المخطط وملف الإصلاح');
});

ok('لا سرّ مكتوب في أي ملف', () => {
  for (const [name, raw] of [['schema', SCHEMA], ['fix 04', FIX]]) {
    const text = stripComments(raw);
    /* لا hex طويل، ولا تعيين سرّ بقيمة فعلية */
    assert.ok(!/'[0-9a-f]{32,}'/i.test(text), `${name}: يبدو أنه يحوي مفتاحاً`);
    assert.ok(!/app\.brc_secret\s*=\s*'[^']+'/i.test(text), `${name}: يحوي إسناداً حرفياً للمفتاح`);
    assert.ok(!/values\s*\(\s*'brc_secret'\s*,\s*'[^']+'/i.test(text), `${name}: يحوي سرّاً في INSERT`);
  }
});

ok('verify_token مبطَلة عن anon/authenticated في ملف الإصلاح', () => {
  assert.match(FIX, /revoke all on function brc\.verify_token\(text\) from public, anon, authenticated/i);
});

console.log(`\n${pass} اختبارات نجحت.`);
