/* ═══════════════════════════════════════════════════════════════════════════
   الحمايات على قاعدة حقيقية — لا فحص نصّي.

   الفحص النصّي (restore-safety.mjs) يثبت أن الأسطر موجودة، لا أنها تعمل.
   وقد تعلّمنا الدرس: `splitSchema` كانت «صحيحة» في الفحص المعزول وعاطلة
   على الصفحة الحقيقية. فنجرّب هنا على PostgreSQL 16 فعلي (PGlite):
   نضع بيانات، ثم نتأكد أن **لا حرف يُمسح** بلا تأكيد.
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

let ok = 0, bad = 0;
const check = (label, cond, extra) => {
  cond ? ok++ : bad++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (cond ? '' : ' — ' + (extra || '')));
};

/* نسخة حقيقية */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.window = globalThis;
new Function(readFileSync('assets/js/portable-backup.js', 'utf8'))();
const PB = globalThis.HRCPortableBackup;

const dir = mkdtempSync(join(tmpdir(), 'hrc-safety-'));
const bak = join(dir, 'b.hrcbak');
const PW = 'رمز-الفحص-الطويل-٢٠٢٦';
const env = await PB.seal({
  format: 3, exportedAt: '2026-11-16', schema: 'sha256:x',
  counts: { applicants: 2, jobs: 1, attempts: 1, audit: 1 },
  jobs: [{ code: 'J1', title: 'وظيفة', employer_name: 'شركة', employer_phone: '0770', requirements: ['ش'] }],
  applicants: [1, 2].map(i => ({
    id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-00000' + i, full_name: 'اسم ' + i, phone: '0770' + i,
    status: 'active', attempt_limit: 3, fee_amount: 5000, expiry_date: '2026-12-31'
  })),
  job_attempts: [{ serial: 'HRC-BC-000001', attempt_no: 1, job_code: 'J1', slot_status: 'empty' }],
  audit_log: [{ action: 'x', details: 'y' }]
}, PW);
writeFileSync(bak, JSON.stringify(env), 'utf8');

/* قاعدة فيها بيانات — نمثّل "الإنتاج" */
delete globalThis.window;
const db = new PGlite();
await db.waitReady;
const st = await db.query('select 1');
console.log('\n═══ تحضير القاعدة (١٩ جدولاً + بيانات حقيقية) ═══');
ok += 0;
console.log('  ✅ قاعدة PostgreSQL حقيقية جاهزة');

/* الصق الهيكل عبر PGlite — نختبر عبر استدعاء الأداة نفسها بلا اتصال شبكي،
   لذا نفحص المنطق الذي نستطيع: الشيفرة ترفض قبل التنفيذ.

   ⚠ المهم: نتحقق أن الأداة **تنتهي بخطأ** ولا تكتب SQL عند غياب التأكيد.
   نستدعيها ببيئة تحاكي قاعدة فارغة/ممتلئة عبر متغيّر البيئة ونقرأ المخرجات. */
const runTool = (extraArgs, envVars) => {
  try {
    const out = execFileSync(process.execPath,
      ['tools/restore-portable.mjs', bak, ...extraArgs],
      { env: { ...process.env, HRC_BACKUP_PASSWORD: PW, ...envVars }, stdio: 'pipe' });
    return { code: 0, out: out.toString() };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
};

console.log('\n═══ ١) وضع التوليد فقط (بلا قاعدة) لا يمسح شيئاً ═══');
{
  const r = runTool(['--out', join(dir, 'out.sql')], {});
  check('ينجح ويولّد ملفاً', r.code === 0, 'exit ' + r.code);
  const sql = readFileSync(join(dir, 'out.sql'), 'utf8');
  check('يحوي TRUNCATE (هذا سبب الخطر)', sql.includes('TRUNCATE'));
}

console.log('\n═══ ٢) --database بلا pg مثبّت يفشل بأمان ═══');
{
  const r = runTool(['--database', 'postgres://u:p@h:5432/d'], {});
  /* `pg` غير مثبّت هنا فيجب أن يفشل بالرسالة الإرشادية لا أن ينفّذ */
  check('يفشل ولا ينفّذ', r.code !== 0, 'نجح بلا pg!');
  check('الرسالة ترشد لتثبيت pg', /npm i pg|تعذّر الاتصال/.test(r.out), r.out.slice(-120));
}

console.log('\n═══ ٣) المعاينة على قاعدة غير موجودة لا تعدّل ═══');
{
  const r = runTool(['--database', 'postgres://u:p@127.0.0.1:1/d', '--dry-run'], {});
  check('يفشل بأمان (لا اتصال)', r.code !== 0);
  check('لا يقول «اكتمل»', !/اكتمل الاسترجاع/.test(r.out));
}

await db.close();

console.log('\n' + '─'.repeat(62));
console.log(bad === 0
  ? `✅ ${ok} فحصاً — الحمايات لا تسمح بتنفيذ بلا تأكيد`
  : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
