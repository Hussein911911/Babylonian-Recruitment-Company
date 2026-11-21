#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   اختبار حزمة الطوارئ — بلا شبكة وبلا قاعدة بيانات
   يُثبت:
     • قراءة صفوف الموظفين ومسارات التخزين من ملف SQL (بلا قاعدة).
     • تشفير/فكّ الحزمة: مطابقة، ورفض كلمة خاطئة، ورفض أي تعديل بايت.
     • رفض كلمة مرور قصيرة.
     • فحص حزمة مصغّرة: PASS سليمة، FAIL عند تعديل ملف أو غياب المانيفست.
   ═══════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { tableRows, storagePaths } from '../tools/dump-facts.mjs';
import { encryptBuffer, decryptBuffer } from '../tools/backup-crypto.mjs';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log(`  ✔ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name} — ${e.message}`); } };
const ROOT = path.resolve(import.meta.dirname, '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const SAMPLE = `-- رأس
INSERT INTO brc."staff" ("active", "created_at", "full_name", "id", "job_title", "phone", "role", "username")
VALUES
  (true, '2026-09-16T23:14:52.458127+00:00', 'المدير', '93900c94-9bde-4176-b418-e8a4721e9fb2', 'مدير عام', '07760058007', 'admin', 'admin'),
  (false, '2026-10-15T08:19:22.578236+00:00', 'محمد', '1ca111fe-5345-4fd3-89b9-4b2a0435e875', 'موظف', '', 'staff', 'Mohammed')
ON CONFLICT ("username") DO NOTHING;

INSERT INTO brc."jobs" ("id", "image_url") VALUES
  ('11111111-1111-1111-1111-111111111111', 'https://x.supabase.co/storage/v1/object/public/job-images/jobs/a.jpg'),
  ('22222222-2222-2222-2222-222222222222', 'https://x.supabase.co/storage/v1/object/public/job-images/jobs/b.png');
`;

console.log('اختبار حزمة الطوارئ:');

ok('يقرأ صفوف الموظفين بلا قاعدة بيانات', () => {
  const rows = tableRows(SAMPLE, 'staff');
  assert.equal(rows.length, 2, `وجد ${rows.length}`);
  assert.equal(rows[0].username, 'admin');
  assert.equal(rows[1].active, false);
  assert.equal(rows[1].job_title, 'موظف');
});

ok('لا يلتقط ON CONFLICT كأنه صف', () => {
  const rows = tableRows(SAMPLE, 'staff');
  assert.ok(rows.every((r) => r.username), 'صف بلا username يعني تسرّب ON CONFLICT');
});

ok('يستخرج مسارات التخزين الفريدة فقط', () => {
  const p = storagePaths(SAMPLE);
  assert.deepEqual(p, ['jobs/a.jpg', 'jobs/b.png']);
});

ok('التشفير والفكّ يعيدان الملف نفسه', () => {
  const data = Buffer.from('بيانات-اختبار '.repeat(500), 'utf8');
  const enc = encryptBuffer(data, 'عبارة-مرور-تجريبية-طويلة', { name: 'x.zip' });
  const { plain, header } = decryptBuffer(enc, 'عبارة-مرور-تجريبية-طويلة');
  assert.ok(plain.equals(data));
  assert.equal(header.name, 'x.zip');
  assert.equal(header.plainSha256, sha(data));
});

ok('كلمة مرور خاطئة تُرفض', () => {
  const enc = encryptBuffer(Buffer.from('x'), 'عبارة-مرور-تجريبية-طويلة');
  assert.throws(() => decryptBuffer(enc, 'عبارة-مرور-أخرى-طويلة'));
});

ok('تعديل بايت واحد يُكشف (وسم GCM)', () => {
  const enc = encryptBuffer(Buffer.from('محتوى سري'), 'عبارة-مرور-تجريبية-طويلة');
  const bad = Buffer.from(enc); bad[bad.length - 20] ^= 0xff;
  assert.throws(() => decryptBuffer(bad, 'عبارة-مرور-تجريبية-طويلة'));
});

ok('كلمة مرور قصيرة تُرفض قبل التشفير', () => {
  assert.throws(() => encryptBuffer(Buffer.from('x'), 'قصيرة'), /قصيرة|١٢/);
});

/* ── حزمة مصغّرة: سليمة ثم معدَّلة ─────────────────────────────────────── */
function miniKit(dir) {
  mkdirSync(path.join(dir, 'database'), { recursive: true });
  mkdirSync(path.join(dir, 'recovery-tools'), { recursive: true });
  const dump = 'INSERT INTO brc."staff" ("username") VALUES (\'admin\');\n';
  writeFileSync(path.join(dir, 'database', 'HRC-FULL-TEST.sql'), dump);
  const manifest = {
    version: '2.0', generatedAt: new Date().toISOString(), commit: 'test',
    dump: { name: 'HRC-FULL-TEST.sql', bytes: Buffer.byteLength(dump), sha256: sha(Buffer.from(dump)), counts: { applicants: 1 } },
    storage: { bucket: 'job-images', expected: ['jobs/a.jpg'], found: [] },
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const files = ['manifest.json', 'database/HRC-FULL-TEST.sql'];
  writeFileSync(path.join(dir, 'CHECKSUMS.sha256'),
    files.map((f) => `${sha(readFileSync(path.join(dir, f)))}  ${f}`).join('\n') + '\n');
  return dir;
}

const work = mkdtempSync(path.join(tmpdir(), 'hrc-kit-test-'));

ok('فحص حزمة سليمة يعطي PASS', () => {
  const dir = miniKit(path.join(work, 'good'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/verify-rescue-kit.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
  assert.match(r.stdout, /صور ناقصة/, 'يجب أن يعلن الصور الناقصة بصراحة');
});

ok('تعديل ملف داخل الحزمة يعطي FAIL', () => {
  const dir = miniKit(path.join(work, 'bad'));
  writeFileSync(path.join(dir, 'database', 'HRC-FULL-TEST.sql'), 'INSERT INTO brc."staff" ("username") VALUES (\'evil\');\n');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/verify-rescue-kit.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'كان يجب أن يُفشل');
  assert.match(r.stdout, /بصمة مخالفة|FAIL/);
});

ok('غياب المانيفست يعطي FAIL', () => {
  const dir = miniKit(path.join(work, 'nomanifest'));
  rmSync(path.join(dir, 'manifest.json'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/verify-rescue-kit.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
});

rmSync(work, { recursive: true, force: true });

console.log('');
if (fail) { console.log(`❌ ${fail} فشل · ${pass} نجح`); process.exit(1); }
console.log(`✅ ${pass} اختباراً ناجحاً — حزمة الطوارئ سليمة الأدوات`);
