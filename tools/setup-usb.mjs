#!/usr/bin/env node
/* ===========================================================================
 *  HRC — إعداد مجلد النسخ الخارجي (USB) في خطوة واحدة
 *  ---------------------------------------------------------------------------
 *  ⚠️ لماذا هذه الأداة؟
 *  لأن الإعداد اليدوي فيه ثلاثة أفخاخ صامتة:
 *   ١) JSON يقرأ `\` كرمز خاص، فمسار ويندوز منسوخ كما هو **يُفسد الملف**.
 *      فيفشل الوكيل بخطأ صياغة لا علاقة له بالـUSB.
 *   ٢) القرص قد يكون للقراءة فقط أو غير موصول، فيصمت النسخ.
 *   ٣) الحساب/al حرف القرص قد يتغيّر، فيصمت النسخ بلا أن يعرف أحد.
 *
 *  هذه الأداة تكتب المسار بصيغة صحيحة، وتفحص كل شيء بالكتابة الحقيقية،
 *  وتخبرك بالحقيقة لا بما تتمنى سماعه.
 *
 *  الاستخدام:
 *    node tools/setup-usb.mjs "E:\HRC-Backups"
 *    node tools/setup-usb.mjs --check          (يفحص الحالي فقط)
 * =========================================================================== */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = resolve(process.env.HRC_OFFICE_HOME || join(ROOT, '.office'));
const CFG = join(HOME, 'backup-config.json');

const ok = (m) => console.log('  ✅ ' + m);
const bad = (m, h) => { console.log('  ❌ ' + m); if (h) console.log('     → ' + h); };
const warn = (m) => console.log('  ⚠️  ' + m);

/* فحص حقيقي: هل يمكن الكتابة هنا فعلاً؟ Stream قد يفشل بلا إنترنت. */
function probe(dir) {
  if (!existsSync(dir)) return { ok: false, why: 'المجلد غير موجود' };
  const f = join(dir, '.hrc-probe-' + Date.now());
  try {
    writeFileSync(f, 'probe', { flag: 'wx' });
    const back = readFileSync(f, 'utf8');
    unlinkSync(f);
    if (back !== 'probe') return { ok: false, why: 'ما كُتب لا يُقرأ كما هو' };
    return { ok: true };
  } catch (e) {
    try { unlinkSync(f); } catch {}
    return { ok: false, why: e.code === 'EACCES' ? 'المجلد للقراءة فقط' : (e.message || String(e)) };
  }
}

/* يكتشف إن كان المسار خارج القرص الرئيسي (USB عادة) */
function lookLikeUsb(p) {
  /* USB غالباً على حرف ثانٍ، أو مسار شبكة — لا نتشدد، نكتفي بتنبيه */
  return /^[A-Za-z]:\\/.test(p) || /^[A-Za-z]:\//.test(p) || /^\\\\/.test(p);
}

const arg = process.argv[2];
console.log('\n' + '═'.repeat(72));
console.log('  فحص مجلد النسخ الخارجي (USB)');
console.log('═'.repeat(72) + '\n');

let cfg = {};
if (existsSync(CFG)) {
  try { cfg = JSON.parse(readFileSync(CFG, 'utf8')); }
  catch (e) {
    bad('ملف الإعداد موجود لكنه تالف (لا يُقرأ كـJSON)', e.message);
    console.log('\n  ⚠️ سبب شائع: مسار ويندوز مكتوب بـ\\ منفردة. استخدم / أو \\\\ .\n');
    process.exit(1);
  }
  console.log('📄 الإعداد الموجود: ' + CFG + '\n');
} else {
  console.log('📄 لا يوجد إعداد بعد — سيُنشأ جديد في:\n   ' + CFG + '\n');
}

/* ── الوضع: فحص فقط ── */
if (arg === '--check') {
  const targets = Array.isArray(cfg.mirrorTargets) ? cfg.mirrorTargets : [];
  if (!targets.length) {
    bad('لا أهداف مضبوطة', 'شغّل: node tools/setup-usb.mjs "E:\\HRC-Backups"');
    process.exit(1);
  }
  let fails = 0;
  console.log('🔍 فحص ' + targets.length + ' هدف:\n');
  for (const t of targets) {
    const dir = typeof t === 'string' ? t : t.path;
    const name = (typeof t === 'object' && t.name) || dir;
    const r = probe(dir);
    if (r.ok) {
      const files = readdirSync(dir).filter(f => /^hrc-[\dTZ.-]+\.hrcdb$/.test(f)).sort();
      ok(name + '  →  ' + dir);
      console.log('     نسخ محفوظة: ' + files.length + (files.length ? ' · الأحدث: ' + files.at(-1) : ''));
    } else {
      fails++;
      bad(name + '  →  ' + dir, r.why);
    }
  }
  console.log('\n' + '─'.repeat(72));
  console.log(fails ? `  ❌ ${fails} هدف غير جاهز` : '  ✅ كل الأهداف جاهزة');
  console.log('─'.repeat(72) + '\n');
  process.exit(fails ? 1 : 0);
}

/* ── الوضع: ضبط هدف جديد ── */
if (!arg) {
  console.log('الاستخدام:\n');
  console.log('  node tools/setup-usb.mjs "E:\\HRC-Backups"\n');
  console.log('  node tools/setup-usb.mjs --check\n');
  console.log('⚠️ ضع المسار بين علامتي تنصيص. حرف E غيّره لحرف USB عندك (شوف This PC).\n');
  process.exit(0);
}

const target = resolve(arg);
console.log('🎯 الهدف: ' + target + '\n');

/* ١) هل المسار معقول؟ */
console.log('▌ ١ — نوع المسار');
if (lookLikeUsb(target)) ok('مسار قرص صالح');
else warn('المسار غير معتاد — تأكد أنك نسخته صحيحاً');

/* ٢) موجود؟ */
console.log('\n▌ ٢ — وجود المجلد');
if (!existsSync(target)) {
  bad('المجلد غير موجود');
  console.log('\n  أنشئه أولاً: وصّل الـUSB ← افتحه ← نقر يمين ← New Folder ← HRC-Backups');
  console.log('  ثم انسخ مساره من شريط العنوان وشغّل الأمر مرة أخرى.\n');
  process.exit(1);
}
ok('المجلد موجود');

/* ٣) قابل للكتابة؟ — الاختبار الحقيقي لـMirror/Stream */
console.log('\n▌ ٣ — الكتابة الفعلية (اختبار Mirror مقابل Stream)');
const p = probe(target);
if (!p.ok) {
  bad('لا يمكن الكتابة أو القراءة هنا', p.why);
  if (/EACCES/.test(p.why || '')) console.log('\n  جرّب تشغيل PowerShell كمسؤول، أو تأكد أن الـUSB غير مقفل/محمي من الكتابة.\n');
  process.exit(1);
}
ok('الكتابة والقراءة تعملان — الملف سيكون على القرص فعلاً');

/* ٤) نسخ قديمة موجودة؟ */
console.log('\n▌ ٤ — محتوى المجلد الحالي');
const existing = readdirSync(target).filter(f => /^hrc-[\dTZ.-]+\.hrcdb$/.test(f));
if (existing.length) ok('يوجد ' + existing.length + ' نسخة سابقة — لن تُحذف');
else ok('المجلد فارغ — ستُضاف أول نسخة عند التشغيل التالي');

/* ٥) كتابة الإعداد */
console.log('\n▌ ٥ — حفظ الإعداد');
mkdirSync(HOME, { recursive: true });
cfg.mirrorKeep = Number(cfg.mirrorKeep) || 3;
const targets = Array.isArray(cfg.mirrorTargets) ? cfg.mirrorTargets : [];
const normalized = target.replace(/\\/g, '/');           /* JSON آمن */
const idx = targets.findIndex(t => ((typeof t === 'string' ? t : t.path) || '').replace(/\\/g, '/') === normalized);
if (idx >= 0) {
  targets[idx] = { name: (targets[idx].name) || 'USB', path: normalized };
  ok('حُدِّث هدف موجود');
} else {
  targets.push({ name: 'USB', path: normalized });
  ok('أُضيف هدف جديد');
}
cfg.mirrorTargets = targets;
writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
ok('كُتب: ' + CFG);
ok('المسار محفوظ بصيغة آمنة (شرطة مائلة بدل شرطة معكوسة)');

/* ٥ب) تنبيه على الحقول الناقصة للنسخ الكامل */
console.log('\n▌ ٦ — حقول النسخ الكامل');
const needed = ['databaseUrl', 'pgpassFile', 'pgBin', 'destination', 'recipientPublicKey', 'recipientPrivateKey', 'privateKeyPasswordFile'];
const missing = needed.filter(k => !cfg[k]);
if (missing.length) {
  warn('ناقص: ' + missing.join(' · '));
  console.log('     هدف USB مضبوط، لكن النسخة الكاملة تحتاج هذه الحقول.');
  console.log('     انسخها من office/backup-config.example.json واملأ قيمها.');
} else {
  ok('كل حقول النسخ الكامل موجودة');
}

console.log('\n' + '═'.repeat(72));
console.log('  ✅ جاهز — اختبر الآن بنسخة حقيقية:');
console.log('     node office/backup-agent.mjs backup');
console.log('  ثم افحص الحالة:');
console.log('     node office/backup-agent.mjs mirror-status');
console.log('═'.repeat(72) + '\n');
