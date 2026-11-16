/* ═══ خطة الاسترجاع: تقول الحقيقة قبل أن تلمس شيئاً ═══════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.window = globalThis;
new Function(readFileSync('assets/js/portable-backup.js', 'utf8'))();
const PB = globalThis.HRCPortableBackup;

const dir = mkdtempSync(join(tmpdir(), 'hrc-plan-'));
const bak = join(dir, 'b.hrcbak');
const PW = 'رمز-الخطة-الطويل-٢٠٢٦';
writeFileSync(bak, JSON.stringify(await PB.seal({
  format: 3, exportedAt: '2026-11-16T09:00:00Z', schema: 'sha256:x',
  counts: { applicants: 724, jobs: 22, attempts: 1533, audit: 3775, staff: 3 },
  applicants: [], jobs: [], job_attempts: [], audit_log: [], staff: []
}, PW)), 'utf8');

const run = (args, env) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['tools/restore-plan.mjs', ...args],
      { env: { ...process.env, ...env }, stdio: 'pipe' }).toString() };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
};

console.log('\n═══ ما تقوله الخطة ═══');
const r = run([bak], { HRC_BACKUP_PASSWORD: PW });
check('تنجح', r.code === 0, 'exit ' + r.code);
check('تعرض أعداد البطاقات', /724/.test(r.out));
check('تعرض أعداد الفرص', /1,533/.test(r.out));
check('تعرض تاريخ النسخة', /2026-11-16/.test(r.out));

console.log('\n═══ الصدق عن الحدود (الأهم) ═══');
check('تقول إن الصور لا تُنقل', /صور الوظائف/.test(r.out) && /تُرفع يدوياً/.test(r.out));
check('تقول إن كلمات المرور لا تُنقل', /كلمات مرور/.test(r.out));
check('تقول إن كود الموقع خارج النسخة', /كود الموقع/.test(r.out));

console.log('\n═══ الخطوات والتحذير ═══');
check('ترتّب الخطوات', /1\./.test(r.out) && /8\./.test(r.out));
check('تحذّر من المسح', /تمسح بيانات/.test(r.out));
check('تنصح بالمعاينة أولاً', /--dry-run/.test(r.out));

console.log('\n═══ لا تلمس قاعدة إطلاقاً ═══');
const src = readFileSync('tools/restore-plan.mjs', 'utf8');
check('لا تستورد pg', !/from 'pg'|require\('pg'\)/.test(src));
check('لا تُرسل أي استعلام', !/\.query\(/.test(src));
check('لا تنفّذ SQL', !/exec\(/.test(src));

console.log('\n═══ كلمة مرور خاطئة تُرفض ═══');
const bad2 = run([bak], { HRC_BACKUP_PASSWORD: 'غلط-٩٩٩٩٩٩٩٩٩٩' });
check('ترفض', bad2.code !== 0);
check('تشرح السبب بأرقام', /الطول \d+/.test(bad2.out), bad2.out.slice(-120));
check('لا تكشف أي بيانات', !/724/.test(bad2.out));

console.log('\n' + '─'.repeat(60));
console.log(bad === 0 ? `✅ ${ok} فحصاً` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
