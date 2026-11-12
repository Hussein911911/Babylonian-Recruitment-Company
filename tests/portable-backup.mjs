/* ═══════════════════════════════════════════════════════════════════════════
   النسخة المحمولة — فحص طبقة التشفير وتوليد SQL
   ---------------------------------------------------------------------------
   يغطّي: seal/open · كلمة خاطئة · تعديل بايت · بصمة · inspect · suggestName
          + توليد SQL من tools/restore-portable.mjs (اقتباس، jsonb، ترتيب)
   لا يحتاج قاعدة ولا متصفحاً — Web Crypto في Node.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/* Node 22 يوفّر crypto (Web Crypto) و btoa/atob عالمياً — لا تجاوز. */
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

const require = createRequire(import.meta.url);
require('../assets/js/portable-backup.js');
const PB = globalThis.HRCPortableBackup;

let pass = 0, fail = 0;
const check = (t, c, d) => {
  if (c) { pass++; console.log('   ✅ ' + t); }
  else { fail++; console.log('   ❌ ' + t + (d ? '  :: ' + d : '')); }
};

const SAMPLE = {
  format: 1, schema: 'test-hash', exportedAt: '2026-11-12T00:00:00Z',
  counts: { jobs: 2, applicants: 2, attempts: 1, audit: 1, serials: 1 },
  jobs: [{ id: 1, code: 'HRC-J-1', title: 'نجار', status: 'available' }],
  applicants: [
    { serial: 'A1', full_name: 'علي حسن', phone: '07701234567', status: 'active' },
    { serial: 'A2', full_name: "محمد 'التميمي'", phone: '0780', status: 'blank', notes: 'سطر\nثانٍ' }
  ],
  job_attempts: [{ serial: 'A1', attempt_no: 1, slot_status: 'reserved', job_code: 'HRC-J-1' }],
  settings: [{ key: 'rules', value: { hold_hours: 24 } }],
  employer_job_credentials: [], issued_serials: [{ serial: 'A1' }],
  audit_log: [{ id: 1, username: 'admin', action: 'اختبار' }],
  staff: [{ id: 'u1', username: 'admin', role: 'admin' }]
};

console.log('\n▌ 1 — ثوابت التنسيق');
check('الصيغة HRC-BACKUP/1', PB.FORMAT === 'HRC-BACKUP/1');
check('AES-256-GCM', PB.CIPHER === 'AES-256-GCM');
check('PBKDF2-SHA256', PB.KDF === 'PBKDF2-SHA256');
check('دورات ≥ 310000', PB.ITERATIONS >= 310000, String(PB.ITERATIONS));
check('حد كلمة المرور 10', PB.MIN_PASSWORD === 10, String(PB.MIN_PASSWORD));
check('Web Crypto متاح', PB.available() === true);

console.log('\n▌ 2 — التشفير والفك');
const pw = 'كلمة-مرور-قوية-للاختبار';
const env = await PB.seal(SAMPLE, pw);
check('يُنتج غلافاً بالصيغة', env.format === PB.FORMAT);
check('ملح 16 بايت', Buffer.from(env.salt, 'base64').length === 16);
check('متجه 12 بايت', Buffer.from(env.iv, 'base64').length === 12);
check('بصمة 64 حرفاً', env.checksum.length === 64);
check('الحمولة ليست نصاً صريحاً', !JSON.stringify(env).includes('علي حسن'));
check('الحمولة ليست الأسماء', !JSON.stringify(env).includes('التميمي'));

const out = await PB.open(env, pw);
check('يعيد نفس عدد البطاقات', out.payload.applicants.length === 2);
check('يعيد الاسم العربي', out.payload.applicants[0].full_name === 'علي حسن');
check('يعيد الاقتباس', out.payload.applicants[1].full_name === "محمد 'التميمي'");
check('يعيد السطر الجديد', out.payload.applicants[1].notes === 'سطر\nثانٍ');
check('يعيد jsonb', out.payload.settings[0].value.hold_hours === 24);
check('البصمة مطابقة', out.meta.checksum === env.checksum);

console.log('\n▌ 3 — الرفض');
try { await PB.open(env, 'كلمة-خطأ-تماماً-99'); check('كلمة خاطئة تُرفض', false); }
catch (e) { check('كلمة خاطئة تُرفض', /غير صحيحة/.test(e.message), e.message); }

const tampered = JSON.parse(JSON.stringify(env));
const buf = Buffer.from(tampered.data, 'base64'); buf[7] ^= 0xff;
tampered.data = buf.toString('base64');
try { await PB.open(tampered, pw); check('تعديل بايت يُرفض', false); }
catch (e) { check('تعديل بايت يُرفض', /غير صحيحة|تغيّر/.test(e.message)); }

const badChecksum = JSON.parse(JSON.stringify(env));
badChecksum.checksum = 'f'.repeat(64);
try { await PB.open(badChecksum, pw); check('بصمة مغيّرة تُرفض', false); }
catch (e) { check('بصمة مغيّرة تُرفض', /بصمة|معدَّلة/.test(e.message), e.message); }

try { await PB.seal(SAMPLE, 'قصيرة'); check('كلمة قصيرة تُرفض عند التشفير', false); }
catch (e) { check('كلمة قصيرة تُرفض عند التشفير', /قصيرة/.test(e.message)); }

try { await PB.open({ format: 'WRONG/9' }, pw); check('صيغة غير معروفة تُرفض', false); }
catch (e) { check('صيغة غير معروفة تُرفض', /غير مدعوم/.test(e.message)); }

const lowIter = JSON.parse(JSON.stringify(env)); lowIter.iterations = 1000;
try { await PB.open(lowIter, pw); check('دورات منخفضة تُرفض', false); }
catch (e) { check('دورات منخفضة تُرفض', /دورات|غير مقبول/.test(e.message)); }

console.log('\n▌ 4 — الملح مختلف كل مرة');
const env2 = await PB.seal(SAMPLE, pw);
check('ملح جديد', env.salt !== env2.salt);
check('متجه جديد', env.iv !== env2.iv);
check('نفس البيانات تنتج حمولة مختلفة', env.data !== env2.data);
check('كلاهما يُفكّ لنفس المحتوى', (await PB.open(env2, pw)).payload.applicants.length === 2);

console.log('\n▌ 5 — inspect بلا كلمة مرور');
const inf = PB.inspect(env);
check('صالح', inf.ok === true);
check('يعرض عدد البطاقات', inf.counts.applicants === 2);
check('لا يكشف الأسماء', !JSON.stringify(inf).includes('علي'));
check('يرفض ملفاً غير صالح', PB.inspect('{"x":1}').ok === false);
check('يرفض نصاً عشوائياً', PB.inspect('not json').ok === false);

console.log('\n▌ 6 — اسم الملف');
const nm = PB.suggestName(new Date('2026-11-12T09:05:00'));
check('صيغة الاسم', /^hrc-backup-\d{4}-\d{2}-\d{2}-\d{4}\.hrcbak$/.test(nm), nm);

console.log('\n▌ 7 — توليد SQL من السكربت');
writeFileSync('/tmp/pb-test.hrcbak', JSON.stringify(env), 'utf8');
try {
  execFileSync('node', ['tools/restore-portable.mjs', '/tmp/pb-test.hrcbak'],
    { env: { ...process.env, HRC_BACKUP_PASSWORD: pw }, encoding: 'utf8' });
  const sql = readFileSync('/tmp/pb-test-restore.sql', 'utf8');
  check('يبدأ بـ BEGIN', /BEGIN;/.test(sql));
  check('يفرّغ قبل الإدخال', /TRUNCATE brc\./.test(sql));
  check('اقتباس مزدوج صحيح', /''التميمي''/.test(sql));
  check('jsonb', /::jsonb/.test(sql));
  check('setval للتدقيق', /setval\(pg_get_serial_sequence\('brc\.audit_log'/.test(sql));
  check('تحقّق نهائي', /SELECT 'jobs' AS tbl/.test(sql));
  check('لا يحتوي أسماء صريحة في التعليقات', !/--.*علي حسن/.test(sql));
} catch (e) {
  check('تشغيل السكربت', false, (e.stderr || e.message || '').slice(0, 200));
}

try { execFileSync('node', ['tools/restore-portable.mjs', '/tmp/pb-test.hrcbak'],
  { env: { ...process.env, HRC_BACKUP_PASSWORD: 'كلمة-غلط-تماماً-00' }, encoding: 'utf8' });
  check('السكربت يرفض كلمة خاطئة', false); }
catch (e) { check('السكربت يرفض كلمة خاطئة', /غير صحيحة/.test(String(e.stderr || e.message))); }

['/tmp/pb-test.hrcbak', '/tmp/pb-test-restore.sql'].forEach((f) => { try { unlinkSync(f); } catch {} });

console.log('\n▌ 8 — الإصدار 2: تخطّي diff في سجلات التدقيق');
{
  /* ما نميّزه: سجل تدقيق عادي (diff صغير) يجب أن يبقى كاملاً، وسجل يحمل
     صورة مضمّنة (diff كبير) يُفقد منه حقل diff فقط. هذا منطق الإصدار 2 في
     brc.recovery_export_v2 — نتحقق من القاعدة نفسها هنا بنمذجة القرار. */
  const SMALL = 16384;
  const rows = [
    { id: 1, diff: { after: { title: 'صغير' } } },           // يبقى
    { id: 2, diff: { after: { image: 'data:image/png;base64,' + 'A'.repeat(40000) } } }, // يُقلَّم
    { id: 3, diff: null }                                     // يبقى
  ];
  const trim = (r) => {
    const size = Buffer.byteLength(JSON.stringify(r.diff || null));
    if (r.diff !== null && size > SMALL) {
      const { diff, ...rest } = r;
      return { ...rest, diffTrimmed: true };
    }
    return r;
  };
  const out = rows.map(trim);
  check('السجل الصغير يبقى بفارقه', out[0].diff && out[0].diff.after.title === 'صغير');
  check('السجل الكبير يُقلَّم', !out[1].diff && out[1].diffTrimmed === true);
  check('السجل الفارغ يبقى', out[2].diff === null && !out[2].diffTrimmed);
  check('لا يُفقد أي سجل', out.length === 3);
  check('المعرّف محفوظ في المقلَّم', out[1].id === 2);

  /* الحجم: 42 ك.ب → 4 بايت. هذا هو الفرق بين 25 م.ب و4.8 م.ب. */
  const before = Buffer.byteLength(JSON.stringify(rows));
  const after = Buffer.byteLength(JSON.stringify(out));
  check('التقليم يوفّر > 90%', (1 - after / before) > 0.9,
    `${before} → ${after}`);
  console.log(`   · الحجم: ${(before/1024).toFixed(1)}KB → ${(after/1024).toFixed(0)}KB`);
}

console.log('\n▌ 9 — النقل على دفعات (Chunked)');
{
  /* payload كبير يجب أن يُشفَّر دون تجاوز حدود المتصفح. */
  const big = {
    format: 2, schema: 'chunk-test', counts: { audit: 500 },
    jobs: [], applicants: [], job_attempts: [], settings: [],
    employer_job_credentials: [], issued_serials: [], staff: [],
    audit_log: Array.from({ length: 500 }, (_, i) => ({
      id: i + 1, username: 'admin', action: 'تعديل', details: 'نص '.repeat(200)
    }))
  };
  const env = await PB.seal(big, 'كلمة-مرور-الدفعات-2026');
  check('حمولة كبيرة تُشفَّر', env.bytes > 200000, String(env.bytes));
  const back = await PB.open(env, 'كلمة-مرور-الدفعات-2026');
  check('تُفكّ كاملة', back.payload.audit_log.length === 500);
  check('البصمة مطابقة', back.meta.checksum === env.checksum);
  console.log(`   · ${(env.bytes/1024).toFixed(0)}KB من البيانات`);
}

console.log('\n' + '═'.repeat(62));
console.log('  ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + fail + ' فاشل');
console.log('═'.repeat(62) + '\n');
process.exit(fail ? 1 : 0);
