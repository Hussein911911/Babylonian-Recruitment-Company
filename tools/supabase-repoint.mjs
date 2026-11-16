#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — تبديل مشروع Supabase بأمر واحد
   ---------------------------------------------------------------------------
   ⚠️ لماذا هذا الملف موجود؟

   عند الطوارئ (توقف Supabase نهائياً) تحتاج موقعك يقف على مشروع جديد.
   لكن معرّف المشروع القديم مكتوب في **مكانين لا علاقة لهما بالكود**:

     • `assets/js/supabase-config.js`  → الرابط والمفتاح (البديهي)
     • `_headers`                      → CSP: `connect-src` و`img-src`
     • `sw.js`                         → أصل الصور في عامل الخدمة
     • `<link rel="preconnect">` × ٧ صفحات

   من يعدّل الأول فقط يخرج بموقع **يفتح لكن لا يتصل** — ويظن أن الاسترجاع
   فشل، فيعيد كل شيء من الصفر في أسوأ وقت. هذه الأداة تعدّل الخمسة معاً
   وتتحقق أن لا أثر للمعرّف القديم بقي.

   ═══ الاستعمال ═══

     node tools/supabase-repoint.mjs <project-ref> <publishable-key>
     node tools/supabase-repoint.mjs --check

   مثال:
     node tools/supabase-repoint.mjs abcdefghijklmnop sb_publishable_xxx

   `--check` لا يعدّل شيئاً — يطبع أين يظهر المعرّف الحالي فقط.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = root + 'assets/js/supabase-config.js';

/* الملفات التي تحمل المعرّف. `assets/js/*` يأتي أولاً: هو المصدر. */
const TARGETS = [
  'assets/js/supabase-config.js',
  '_headers',
  'sw.js',
  '404.html', 'apply.html', 'dashboard.html', 'hrc-light.html',
  'hrc-standalone.html', 'index.html', 'verify.html'
];

function readCurrent() {
  const cfg = readFileSync(CONFIG, 'utf8');
  const url = (cfg.match(/url:\s*'([^']+)'/) || [])[1] || '';
  const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/) || [])[1] || '';
  const key = (cfg.match(/publishableKey:\s*'([^']+)'/) || [])[1] || '';
  return { url, ref, key };
}

const cur = readCurrent();
if (!cur.ref) {
  console.error('❌ لم أستطع قراءة معرّف المشروع الحالي من ' + CONFIG);
  process.exit(1);
}

/* ═══ --check: أين يظهر المعرّف؟ ═══════════════════════════════════════════ */
if (process.argv.includes('--check')) {
  console.log('\n  المشروع الحالي: ' + cur.ref);
  console.log('  المفتاح        : ' + (cur.key ? cur.key.slice(0, 24) + '…' : '(غير موجود)'));
  console.log('\n  أماكن ظهور المعرّف:');
  let total = 0;
  for (const f of TARGETS) {
    const p = root + f;
    if (!existsSync(p)) { console.log('    ⚠ ' + f + '  (غير موجود)'); continue; }
    const n = (readFileSync(p, 'utf8').match(new RegExp(cur.ref, 'g')) || []).length;
    total += n;
    console.log('    ' + (n ? '•' : '○') + ' ' + f + ' › '+ (n ? n + ' موضعاً' : 'لا شيء'));
  }
  console.log('\n  المجموع: ' + total + ' موضعاً في ' + TARGETS.length + ' ملفاً.');
  console.log('\n  للتبديل:  node tools/supabase-repoint.mjs <project-ref> <publishable-key>\n');
  process.exit(0);
}

/* ═══ التبديل ══════════════════════════════════════════════════════════════ */
const [, , newRef, newKey] = process.argv;
if (!newRef || !newKey) {
  console.error('\n❌ الاستعمال:');
  console.error('   node tools/supabase-repoint.mjs <project-ref> <publishable-key>');
  console.error('   node tools/supabase-repoint.mjs --check\n');
  console.error('   project-ref: من Supabase → Settings → API → Project URL');
  console.error('   publishable-key: المفتاح العام (sb_publishable_…)\n');
  process.exit(1);
}
if (!/^[a-z0-9]{15,25}$/.test(newRef)) {
  console.error('❌ معرّف مشروع غير صالح: ' + newRef);
  console.error('   الصيغة المتوقّعة: أحرف إنجليزية صغيرة وأرقام، ٢٠ خانة تقريباً.');
  process.exit(1);
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(newKey) && !/^eyJ/.test(newKey)) {
  console.error('❌ مفتاح غير صالح — يجب أن يبدأ بـ`sb_publishable_` أو `eyJ` (anon قديم).');
  console.error('   ⛔ لا تستعمل `sb_secret_` أبداً: يتجاوز كل سياسات الأمان.');
  process.exit(1);
}
if (/sb_secret_/.test(newKey)) {
  console.error('⛔ مرفوض: هذا مفتاح سرّي. المفتاح المنشور فقط يُوضع في الواجهة.');
  process.exit(1);
}
if (newRef === cur.ref) {
  console.log('ℹ️ المشروع لم يتغيّر: ' + newRef);
  process.exit(0);
}

const oldRef = cur.ref;
let changed = 0;
for (const f of TARGETS) {
  const p = root + f;
  if (!existsSync(p)) continue;
  const before = readFileSync(p, 'utf8');
  let after = before.split(oldRef).join(newRef);

  if (f === 'assets/js/supabase-config.js') {
    /* المفتاح أيضاً، والتعليق يذكر المشروع */
    after = after.replace(/url:\s*'[^']*'/, "url: 'https://" + newRef + ".supabase.co'");
    after = after.replace(/publishableKey:\s*'[^']*'/, "publishableKey: '" + newKey + "'");
  }

  if (after !== before) {
    writeFileSync(p, after);
    changed++;
    const n = (before.match(new RegExp(oldRef, 'g')) || []).length;
    console.log('  ✅ ' + f + ' › '+ n + ' موضعاً');
  }
}

/* ═══ التحقق: لا أثر للقديم ════════════════════════════════════════════════ */
console.log('\n  فحص بقايا المشروع القديم…');
let residue = 0;
for (const f of TARGETS) {
  const p = root + f;
  if (!existsSync(p)) continue;
  if (readFileSync(p, 'utf8').includes(oldRef)) {
    console.error('  ❌ بقيت إشارة في ' + f);
    residue++;
  }
}
const nowCfg = readCurrent();
console.log('\n  المشروع الجديد: ' + nowCfg.ref);
console.log('  المفتاح        : ' + nowCfg.key.slice(0, 24) + '…');
if (residue) {
  console.error('\n❌ فشل التبديل — ' + residue + ' ملفاً يحمل المعرّف القديم.');
  process.exit(1);
}
if (nowCfg.ref !== newRef) {
  console.error('\n❌ الإعدادات لا تقرأ المشروع الجديد.');
  process.exit(1);
}
console.log('\n✅ تبديل نظيف في ' + changed + ' ملفاً.\n');
console.log('   الخطوة التالية — لا تنسها:');
console.log('     npm run csp      ← يعيد بناء سياسة CSP من الإعدادات');
console.log('     npm run build    ← يعيد بناء الملفات المدمجة');
console.log('     npm run schema:all\n');
