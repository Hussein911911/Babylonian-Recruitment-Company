#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   hrc-plan — «ماذا سأفعل بالضبط؟» قبل أن أفعل شيئاً

   المالك اختار الطريق الثاني (2026-11-16) وقال إنه «أسهل للمدير».
   وأسهل لا تكون أسهل بالخطوات فقط، بل بأن **تعرف ما سيحدث قبل حدوثه**.

   هذه الأداة لا تلمس القاعدة إطلاقاً. تقرأ النسخة (بعد كلمة المرور)،
   وتفحص الكود، وتطبع:
     • ما تحمله النسخة فعلاً — بالأعداد
     • ما لا تحمله — بصراحة (الصور، كلمات المرور)
     • ما ستحتاج فعله بيدك بعد ذلك
     • هل هذا المشروع جديد أم فيه بيانات

   الاستعمال:
     node tools/restore-plan.mjs نسخة.hrcbak
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createInterface } from 'node:readline';

const ok = (m) => console.log('  ✓ ' + m);
const info = (m) => console.log('  · ' + m);
const warn = (m) => console.log('  ⚠ ' + m);
const die = (m) => { console.error('\n  ✗ ' + m + '\n'); process.exit(1); };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(String(a || '').trim()); });
  });
}

/* فكّ التشفير — نفس منطق tools/restore-portable.mjs، مقصود تكراره هنا
   لأن هذه الأداة يجب أن تعمل وحدها بلا اعتماد على غيرها. */
async function decrypt(raw, password) {
  const env = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
  if (env.format !== 'HRC-BACKUP/1') die('الملف ليس نسخة بصيغة HRC-BACKUP/1');
  const salt = Buffer.from(env.salt, 'base64');
  const iv = Buffer.from(env.iv, 'base64');
  const data = Buffer.from(env.data, 'base64');
  const base = await webcrypto.subtle.importKey('raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: env.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try {
    plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, data);
  } catch {
    die('كلمة المرور غير صحيحة، أو أن الملف تغيّر بعد تنزيله\n     (الطول ' +
        password.length + ' محرفاً · الحمولة ' + data.length + ' بايتاً)');
  }
  return JSON.parse(Buffer.from(plain).toString('utf8'));
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) die('لم تحدّد ملف النسخة. مثال:\n     node tools/restore-plan.mjs hrc-backup-2026-11-16.hrcbak');
if (!existsSync(file)) die('الملف غير موجود: ' + file);

const raw = readFileSync(file, 'utf8');
const password = process.env.HRC_BACKUP_PASSWORD || await ask('  كلمة مرور النسخة: ');
if (!password) die('لم تُدخل كلمة مرور');

const payload = await decrypt(raw, password);
const c = payload.counts || {};
const n = (k, alt) => (c[k] != null ? c[k] : (alt || []).length);

console.log('\n' + '═'.repeat(64));
console.log('  ماذا تحمل هذه النسخة؟');
console.log('═'.repeat(64) + '\n');

ok(`تاريخ النسخة: ${payload.exportedAt || '—'}`);
console.log('');
for (const [label, v] of [
  ['البطاقات', n('applicants', payload.applicants)],
  ['الوظائف', n('jobs', payload.jobs)],
  ['الفرص', n('attempts', payload.job_attempts)],
  ['سجل التدقيق', n('audit', payload.audit_log)],
  ['الحسابات', n('staff', payload.staff)]
]) console.log(`     ${fmt(v).padStart(8)}  ${label}`);

console.log('\n' + '─'.repeat(64));
console.log('  ما فيها فعلاً  ↔  ما ستحتاج فعله بيدك');
console.log('─'.repeat(64) + '\n');

const rows = [
  ['الوظائف والبطاقات والفرص', true, null],
  ['سجل التدقيق والإعدادات', true, null],
  ['أرقام البطاقات المُصدرة', true, null],
  ['الحسابات (أسماء وأدوار)', true, null],
  ['كلمات مرور الحسابات', false, 'تُعاد من لوحة Supabase — لا يمكن نقلها'],
  ['صور الوظائف في Storage', false, 'تُرفع يدوياً — النسخة لا تحمل ملفات Storage'],
  ['كود الموقع', false, 'من GitHub — نسخة عندك أصلاً'],
  ['إعدادات مشروع Supabase', false, 'مفاتيح ومخطط — تُضبط في المشروع الجديد']
];
for (const [item, carried, note] of rows) {
  console.log(`  ${carried ? '✓' : '✗'}  ${item}${note ? '\n        → ' + note : ''}`);
}

console.log('\n' + '─'.repeat(64));
console.log('  الخطوات، بالترتيب');
console.log('─'.repeat(64) + '\n');
[
  'مشروع Supabase جديد وفارغ',
  'نسخ الهيكل: psql "الرابط" -f docs/schema.sql',
  'معاينة:  node tools/restore-portable.mjs "' + file + '" --database "الرابط" --dry-run',
  'النقل:   node tools/restore-portable.mjs "' + file + '" --database "الرابط"',
  'ربط الموقع: node tools/supabase-repoint.mjs <المعرف> <المفتاح>',
  'رفع الصور يدوياً إلى Storage',
  'إعادة كلمات مرور الموظفين',
  'التحقّق من الأعداد أعلاه'
].forEach((s, i) => console.log(`     ${i + 1}.  ${s}`));

console.log('\n' + '═'.repeat(64));
warn('الخطوة ٤ تمسح بيانات المشروع الهدف. لا توجّهها إلى الإنتاج.');
warn('الخطوة ٣ معاينة فقط — لا تلمس شيئاً. استخدمها دائماً أولاً.');
console.log('═'.repeat(64) + '\n');
