#!/usr/bin/env node
/* ===========================================================================
 *  HRC — طبيب الحاسبة: يفحص كل شيء يحتاجه النسخ الاحتياطي في أمر واحد
 *  ---------------------------------------------------------------------------
 *  ⚠️ لماذا؟
 *  لأن كل خطأ في هذه المنظومة يظهر لاحقاً بصورة غامضة: «فشل النسخ».
 *  هذا الأمر يفحص المتطلبات **قبل** أن نحاول، ويقول بالعربية ما ينقص
 *  وكيف يُصلح. لا يفترض شيئاً، ولا يعدّل شيئاً — يفحص فقط.
 * =========================================================================== */
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = resolve(process.env.HRC_OFFICE_HOME || join(ROOT, '.office'));
const R = [];
const add = (state, title, detail, fix) => R.push({ state, title, detail, fix });
const OK = '✅', NO = '❌', WARN = '⚠️ ', INFO = 'ℹ️ ';

/* ── ١) نظام التشغيل ─────────────────────────────────────────────────────── */
add(INFO, 'نظام التشغيل', process.platform === 'win32' ? 'Windows' : process.platform);

/* ── ٢) Node ─────────────────────────────────────────────────────────────── */
{
  const v = process.versions.node;
  const major = Number(v.split('.')[0]);
  add(major >= 20 ? OK : NO, 'Node.js',
    'الإصدار ' + v + (major >= 20 ? '' : ' — يحتاج ٢٠ أو أحدث'),
    major >= 20 ? null : 'نزّل من nodejs.org الإصدار 20 LTS أو أحدث');
}

/* ── ٣) PostgreSQL / pg_dump ─────────────────────────────────────────────── */
{
  const cfgPath = join(HOME, 'backup-config.json');
  let binDir = null;
  if (existsSync(cfgPath)) { try { binDir = JSON.parse(String(readFileSync(cfgPath))).pgBin; } catch {} }
  const probe = (dir) => {
    const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
    const p = dir ? join(dir, exe) : null;
    if (p && existsSync(p)) return p;
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    return r.status === 0 ? exe : null;
  };
  const found = probe(binDir) || probe(null);
  if (found) add(OK, 'pg_dump', found);
  else add(NO, 'pg_dump (أداة نسخ PostgreSQL)', 'غير موجود',
    'هذه أداة PostgreSQL — تحميلها لا يحتاج تشغيل قاعدة بيانات كاملة، فقط "Command Line Tools"');
}

/* ── ٤) إعداد المكتب ─────────────────────────────────────────────────────── */
{
  const cfg = join(HOME, 'backup-config.json');
  if (!existsSync(cfg)) add(NO, 'ملف الإعداد backup-config.json', 'غير موجود في ' + HOME,
    'انسخ office/backup-config.example.json إلى ' + HOME + ' واملأه');
  else {
    try {
      const j = JSON.parse(String(readFileSync(cfg)));
      const need = ['databaseUrl','pgpassFile','pgBin','destination','recipientPublicKey','recipientPrivateKey','privateKeyPasswordFile'];
      const miss = need.filter(k => !j[k]);
      add(miss.length ? WARN : OK, 'ملف الإعداد',
        miss.length ? 'ناقص: ' + miss.join(', ') : 'مكتمل الحقول الأساسية');
      const t = Array.isArray(j.mirrorTargets) ? j.mirrorTargets : [];
      add(t.length ? OK : WARN, 'أهداف النسخ الخارجي',
        t.length ? t.map(x => (x.name || '') + ' → ' + x.path).join(' · ') : 'لا أهداف — لن تُنسخ إلى Drive',
        t.length ? null : 'شغّل: node tools/setup-drive.mjs "مسار مجلد Drive"');
    } catch (e) {
      add(NO, 'ملف الإعداد تالف', String(e.message).slice(0, 90),
        'سبب شائع: مسار ويندوز بـ\\ منفردة. شغّل أداة setup-drive لتُصلحه');
    }
  }
}

/* ── ٥) مجلدات المفاتيح والأمان ─────────────────────────────────────────── */
{
  const cfg = existsSync(join(HOME,'backup-config.json')) ? (()=>{try{return JSON.parse(String(readFileSync(join(HOME,'backup-config.json'))))}catch{return {}}})() : {};
  for (const [label, p, why] of [
    ['مجلد المفتاح العام', cfg.recipientPublicKey ? dirname(resolve(cfg.recipientPublicKey)) : join(ROOT,'..','HRC-Private'), 'نسخة من المفتاح العام'],
    ['مجلد المفتاح الخاص', cfg.recipientPrivateKey ? dirname(resolve(cfg.recipientPrivateKey)) : null, 'المفتاح الخاص — يجب أن يكون على قرص منفصل'],
  ]) {
    if (!p) continue;
    if (existsSync(p)) add(OK, label, p);
    else add(WARN, label, 'غير موجود: ' + p, 'أنشئه: mkdir "' + p + '"');
  }
}

/* ── ٦) مفاتيح التشفير ──────────────────────────────────────────────────── */
{
  const cfg = existsSync(join(HOME,'backup-config.json')) ? (()=>{try{return JSON.parse(String(readFileSync(join(HOME,'backup-config.json'))))}catch{return {}}})() : {};
  const pub = cfg.recipientPublicKey, priv = cfg.recipientPrivateKey;
  if (pub && existsSync(pub)) add(OK, 'المفتاح العام', pub);
  else add(NO, 'المفتاح العام', 'غير موجود', 'شغّل: node office/backup-agent.mjs keygen');
  if (priv && existsSync(priv)) add(OK, 'المفتاح الخاص', priv);
  else add(NO, 'المفتاح الخاص', 'غير موجود', 'شغّل: node office/backup-agent.mjs keygen (ثم انقله بعيداً عن النسخ)');
}

/* ── ٧) Google Drive ────────────────────────────────────────────────────── */
{
  const j = existsSync(join(HOME,'backup-config.json')) ? (()=>{try{return JSON.parse(String(readFileSync(join(HOME,'backup-config.json'))))}catch{return {}}})() : {};
  const t = Array.isArray(j.mirrorTargets) ? j.mirrorTargets : [];
  const gd = t.find(x => /drive/i.test((x.name||'') + (x.path||'')));
  if (!gd) add(WARN, 'Google Drive', 'غير مضبوط', 'node tools/setup-drive.mjs "مسار مجلد HRC-Backups"');
  else {
    const dir = gd.path;
    if (!existsSync(dir)) add(NO, 'Google Drive', 'المجلد غير موجود: ' + dir, 'شغّل Google Drive Desktop وأنشئ مجلد HRC-Backups');
    else {
      const f = join(dir, '.hrc-probe-' + Date.now());
      try {
        writeFileSync(f, 'x'); readFileSync(f, 'utf8'); unlinkSync(f);
        const n = readdirSync(dir).filter(x => /^hrc-[\dTZ.-]+\.hrcdb$/.test(x)).length;
        add(OK, 'Google Drive', dir + ' — الكتابة تعمل · ' + n + ' نسخة');
      } catch (e) {
        add(NO, 'Google Drive', 'لا يمكن الكتابة — ' + (e.code||''), 'تأكد أن Drive على وضع Mirror لا Stream');
      }
    }
  }
}

/* ── ٨) النتيجة ─────────────────────────────────────────────────────────── */
console.log('\n' + '═'.repeat(74));
console.log('   فحص حاسبة النسخ الاحتياطي');
console.log('═'.repeat(74) + '\n');
for (const r of R) {
  console.log(r.state + ' ' + r.title);
  if (r.detail) console.log('     ' + r.detail);
  if (r.fix) console.log('     ↳ ' + r.fix);
}
const fails = R.filter(r => r.state === NO).length;
const warns = R.filter(r => r.state === WARN).length;
console.log('\n' + '─'.repeat(74));
if (!fails) console.log('   ✅ لا مشاكل مانعة' + (warns ? ' · ' + warns + ' تنبيه' : ''));
else console.log('   ❌ ' + fails + ' مشكلة مانعة · ' + warns + ' تنبيه');
console.log('─'.repeat(74) + '\n');
process.exit(fails ? 1 : 0);
