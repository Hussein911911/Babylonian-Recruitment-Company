#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   اختبار ترقيع كتلتَي المشغّلات (docs/sql-parts/fixes/03-restore-trigger-blocks.sql)
   ---------------------------------------------------------------------------
   يُثبت:
     • الكتلتان المكتوبتان لا تحتويان «TRIGGER ALL» (تتطلّب superuser).
     • الترقيع يستبدل عبارتين فقط ويحافظ على عدد العبارات وترتيبها.
     • بقية نص الملف تبقى بايتاً ببايت.
     • الترقيع مرّة ثانية يرفض العمل (لا ترقيع مزدوج بصمت).
   ═══════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitStatements } from '../tools/sql-split-core.mjs';
import { patchTriggerBlocks, loadBlocks } from '../tools/patch-restore-triggers.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log(`  ✔ ${name}`); };

const SAMPLE = `-- رأس
SET client_encoding = 'UTF8';

BEGIN;

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'brc' AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE brc.%I DISABLE TRIGGER ALL', t.relname);
  END LOOP;
EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;

INSERT INTO brc."staff" (id) VALUES ('x');

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'brc' AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE brc.%I ENABLE TRIGGER ALL', t.relname);
  END LOOP;
END $$;

COMMIT;

-- ذيل تعليقات
`;

console.log('اختبار ترقيع المشغّلات:');

ok('كتلة التعطيل في ملف الإصلاح لا تستعمل TRIGGER ALL', () => {
  const b = loadBlocks();
  assert.ok(!/TRIGGER\s+ALL/i.test(b.disable), 'كتلة التعطيل ما زالت تستعمل TRIGGER ALL');
  assert.match(b.disable, /DISABLE TRIGGER %I/);
  assert.match(b.disable, /NOT g\.tgisinternal/);
});

ok('كتلة التفعيل في ملف الإصلاح لا تستعمل TRIGGER ALL', () => {
  const b = loadBlocks();
  assert.ok(!/TRIGGER\s+ALL/i.test(b.enable), 'كتلة التفعيل ما زالت تستعمل TRIGGER ALL');
  assert.match(b.enable, /ENABLE TRIGGER %I/);
  assert.match(b.enable, /tgenabled <> 'O'/);
});

ok('الترقيع يستبدل عبارتين ويحافظ على عدد العبارات', () => {
  const before = splitStatements(SAMPLE).length;
  const res = patchTriggerBlocks(SAMPLE);
  assert.equal(res.replaced.length, 2);
  assert.equal(splitStatements(res.text).length, before);
  assert.equal(res.statements, before);
  assert.ok(!/TRIGGER\s+ALL/i.test(res.text), 'بقيت عبارة TRIGGER ALL في الناتج');
});

ok('بقية النص تبقى كما هي (بايتاً ببايت خارج الكتلتين)', () => {
  const res = patchTriggerBlocks(SAMPLE);
  assert.ok(res.text.startsWith("-- رأس\nSET client_encoding = 'UTF8';\n\nBEGIN;\n"));
  assert.ok(res.text.includes(`INSERT INTO brc."staff" (id) VALUES ('x');`));
  assert.ok(res.text.trimEnd().endsWith('-- ذيل تعليقات'));
});

ok('الترقيع مرّة ثانية يُرفض (لا ترقيع مزدوج بصمت)', () => {
  const once = patchTriggerBlocks(SAMPLE).text;
  assert.throws(() => patchTriggerBlocks(once), /المتوقع ترقيع 2 عبارة/);
});

ok('ملف نظيف (مولّد مُصلَح) لا يُرفض عند allowNone، ويُرفض بلا هذا العلم', () => {
  const clean = '-- رأس\nselect 1;';
  assert.throws(() => patchTriggerBlocks(clean), /المتوقع ترقيع 2 عبارة/, 'قبل الإصلاح كان الرفض إلزامياً');
  const res = patchTriggerBlocks(clean, undefined, { allowNone: true });
  assert.equal(res.clean, true);
  assert.equal(res.replaced.length, 0);
  assert.equal(res.text, clean, 'لم يتغيّر بايت');
});

ok('ملف الإصلاح نفسه سليم الترميز (UTF-8 بلا BOM) وCRLF غير مطلوب له', () => {
  const buf = readFileSync(new URL('../docs/sql-parts/fixes/03-restore-trigger-blocks.sql', import.meta.url));
  assert.notEqual(buf[0], 0xef, 'يبدأ بـ BOM — psql لا يحبّه');
  assert.ok(!buf.includes(Buffer.from('\r\n')), 'يحتوي CRLF — ملفات .sql في المستودع LF');
});

console.log(`\n${pass} اختبارات نجحت.`);
