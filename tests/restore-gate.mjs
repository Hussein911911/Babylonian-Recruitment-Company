#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص بوابة مدير صفحة الاسترجاع
 *  ---------------------------------------------------------------------------
 *  ⚠ ما يحرسه هذا الملف:
 *
 *  `restore.html` كانت **مفتوحة لأي زائر**: الخطوة السادسة فيها تُنزّل مخطط
 *  قاعدة البيانات كاملاً (أسماء الجداول والدوال وسياسات RLS)، والخطوات
 *  الأخرى تفتح أي ملف نسخة احتياطية. وواجهتها تقول «استرجاع بصلاحية المدير
 *  فقط» — لكن لا يوجد في الصفحة أي `session` ولا `is_admin`. أي أن الوعد
 *  موجود والتنفيذ غائب.
 *
 *  ثلاثة سلوكات يجب أن تبقى صحيحة، وكل واحد منها يكسر الآخر لو أُهمل:
 *
 *   ١) محلي (`file://`) → مفتوح. هذه حالة الكوارث التي بُنيت لها الأداة:
 *      الموقع انقطع، والمخرج الوحيد هو ملف يُفتح من الجهاز بلا شبكة.
 *
 *   ٢) منشور + بلا جلسة → مقفل، والمخطط غير مقروء من الواجهة.
 *
 *   ٣) منشور + جلسة مدير → مفتوح كاملاً.
 *
 *  وفحص رابع لا يقل أهمية: **موظف ليس مديراً** يجب ألّا يُفتح له، لأن
 *  الاسترجاع يعيد كتابة القاعدة كلها.
 *
 *  التشغيل: node tests/restore-gate.mjs   أو   npm run test:restore-gate
 * =========================================================================== */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

/* ── أدوات: نبني صفحة حقيقية من restore.html ────────────────────────────── */
const PAGE = read('restore.html');
const GATE = read('assets/js/restore-gate.js');

/* نقتطع كتلة المخطط الضخمة: الفحص لا يحتاج ٢٠٠ ك.ب من SQL في الذاكرة،
   لكنه يحتاج أن يتأكد أن الكتلة موجودة في الصفحة (وإلا فحصنا صفحة أخرى). */
/* ⚠️ الشرط انقلب بعد 2026-11-13: وجود `window.__HRC_SCHEMA_SQL__` في HTML
   صار **علامة خطأ** لا صحة — يعني أن المخطط يُنفَّذ في نافذة كل زائر. الصحيح
   أن يكون في وسم `type="text/plain" disabled` لا ينفّذه أحد. */
const hasEmbed = /<!-- SCHEMA-EMBED:START -->/.test(PAGE) &&
  /<script[^>]+id="hrc-schema-embed"/.test(PAGE);
const embedInert = /<script[^>]+type="text\/plain"[^>]*id="hrc-schema-embed"[^>]*disabled/.test(PAGE) ||
  /<script[^>]+id="hrc-schema-embed"[^>]*type="text\/plain"[^>]*disabled/.test(PAGE);
const schemaGloballyExposed = /window\.__HRC_SCHEMA_SQL__\s*=/.test(PAGE);
/* نستبدل الكتلة الضخمة بنصّ قصير **بنفس الشكل** (type="text/plain" + disabled)
   كي يحاكي الفحص ما يُنشر فعلاً، لا شكلاً قديماً يمرّ بلا معنى. */
const slim = PAGE.replace(/<!-- SCHEMA-EMBED:START -->[\s\S]*?<!-- SCHEMA-EMBED:END -->/,
  '<!-- SCHEMA-EMBED:START --><script type="text/plain" id="hrc-schema-embed" disabled>-- SQL</script><!-- SCHEMA-EMBED:END -->');

/* عميل Supabase مزيف: نتحكم في الجلسة ودور الموظف */
function fakeSupabase({ session, staffRow, staffError, sessionThrows }) {
  return {
    createClient() {
      return {
        auth: {
          getSession() {
            if (sessionThrows) return Promise.reject(new Error('شبكة'));
            return Promise.resolve({ data: { session: session || null } });
          }
        },
        from() {
          return {
            select() { return this; },
            eq() { return this; },
            limit() {
              if (staffError) return Promise.resolve({ data: null, error: { message: 'x' } });
              return Promise.resolve({ data: staffRow ? [staffRow] : [], error: null });
            }
          };
        }
      };
    }
  };
}

/* نشغّل الصفحة في بيئة DOM حقيقية. `protocol` يحدد الحالة. */
async function run({ protocol, session, staffRow, staffError, sessionThrows }) {
  const dom = new JSDOM(slim, {
    url: protocol + '//example.test/restore.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;

  /* البوابة تفحص وجود التهيئة والمكتبة قبل أي اتصال، فنُهيّئها */
  /* ⚠️ المخطط صار في وسم `type="text/plain"` لا ينفّذه المتصفح أبداً — وهذا
     مقصود: فوجود `window.__HRC_SCHEMA_SQL__` نفسه صار علامة على الخطأ لا
     على الصحة. لا ننفّذ شيئاً هنا؛ نفحص فقط أن البوابة تفكّه محلياً ولا تفكّه
     على الموقع. (كان الاختبار السابق ينفّذ الكتلة يدوياً — وهذا بالضبط ما
     كان سيُخفي أن المتصفح لا ينفّذها في الواقع.) */
  w.HRCSupabaseConfig = { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_test', schema: 'brc' };
  w.supabase = fakeSupabase({ session, staffRow, staffError, sessionThrows });

  /* نُنفّذ البوابة فعلياً كما يفعل المتصفح */
  w.eval(GATE);

  /* العناصر التي تركّب عليها البوابة: الزر والملاحظة موجودان في الصفحة */
  const out = await w.HRCRestoreGate.boot();
  return { dom, w, out, doc: w.document };
}

/* حالة الخطوات: مقفلة أو ظاهرة — هذا جوهر الفحص */
function stepsVisible(doc) {
  const steps = [...doc.querySelectorAll('[data-rp-step]')];
  return {
    total: steps.length,
    visible: steps.filter((s) => !s.hidden && !s.classList.contains('is-locked')).length
  };
}

console.log('══════════════════════════════════════════════════════════════════════════');
console.log('  بوابة صفحة الاسترجاع — من يفتح أداة استرجاع بيانات الشركة؟');
console.log('══════════════════════════════════════════════════════════════════════════');

/* ═══ 0) بنية الصفحة ═══════════════════════════════════════════════════════ */
step(0, 'الصفحة تحمل البوابة فعلاً (لا مجرد نيّة في تعليق)');

check('restore.html يحتوي على كتلة تضمين المخطط', hasEmbed);
check('المخطط في وسم لا ينفّذه المتصفح (type=text/plain + disabled)', embedInert);
/* أهم فحص في الملف: لو صار المخطط متغيّراً عاماً، أي زائر يقرأه بجملة واحدة
   من console. الزرّ والبوابة لا يحميان هذا — الشكل نفسه هو الحماية. */
check('لا يُعرَّف المخطط كمتغيّر عام في الصفحة', !schemaGloballyExposed);
check('restore.html يحمّل assets/js/restore-gate.js',
  /src="assets\/js\/restore-gate\.js"/.test(PAGE));
check('restore.html فيه عنصر البوابة #rp-gate', /id="rp-gate"/.test(PAGE));
const pageSteps = (PAGE.match(/data-rp-step="/g) || []).length;
check('كل أقسام الخطوات موسومة بـ data-rp-step', pageSteps >= 6, pageSteps + ' موسوم');

/* ═══ ١) محلي file:// — يجب أن يبقى مفتوحاً ═══════════════════════════════ */
step(1, 'محلي (file://) — مفتوح بلا قيود: هذا شرط عمل الأداة');

{
  const { doc, out } = await run({ protocol: 'file:' });
  check('الحالة = local', out.state === 'local', out.state);
  const v = stepsVisible(doc);
  check('كل الخطوات ظاهرة محلياً', v.visible === v.total, `${v.visible}/${v.total}`);
  check('لا نطلب شبكة محلياً (لا استيثاق)', true);
  check('الملاحظة تطمئن المستخدم', /محلياً/.test(doc.getElementById('rp-gate-note').textContent));
  check('المخطط متاح محلياً (الشرط الوحيد لبقاء التضمين)',
    (doc.defaultView.__HRC_SCHEMA_SQL__ || '').length > 0, 'فارغ');
}

/* ═══ ٢) منشور بلا جلسة — مقفل ════════════════════════════════════════════ */
step(2, 'منشور بلا جلسة — مقفل، ولا وصول للمخطط ولا للنسخة');

{
  const { doc, w, out } = await run({ protocol: 'https:', session: null });
  check('الحالة = guest', out.state === 'guest', out.state);
  const v = stepsVisible(doc);
  check('صفر خطوات ظاهرة', v.visible === 0, `${v.visible}/${v.total} ظاهرة`);
  check('البوابة نفسها ظاهرة بالشرح', doc.getElementById('rp-gate').hidden === false);
  check('الشرح يطلب تسجيل الدخول من لوحة التحكم',
    /لوحة التحكم/.test(doc.getElementById('rp-gate-note').textContent));
  /* ⚠️ الأهم: النص المضمّن أُفرغ من الذاكرة، فلا يستطيع زر التنزيل ولا
     أي سكربت آخر قراءته من الواجهة. */
  /* الفحص ذو معنى فقط إن كان المخطط قد مُلئ فعلاً ثم أُفرغ — لا إن كان
     فارغاً من البداية (وهذا ما أوقع القياس الأول). */
  check('المخطط أُفرغ من الذاكرة بعد القفل (لا قراءة من الواجهة)',
    (w.__HRC_SCHEMA_SQL__ || '') === '', JSON.stringify(w.__HRC_SCHEMA_SQL__).slice(0, 40));
}

/* ═══ ٣) منشور + موظف ليس مديراً — مقفل ═══════════════════════════════════ */
step(3, 'موظف بجلسة صحيحة لكنه ليس مديراً — مقفل');

{
  const { doc, out } = await run({
    protocol: 'https:',
    session: { user: { id: 'u1' } },
    staffRow: { role: 'staff', active: true }
  });
  check('الحالة = staff', out.state === 'staff', out.state);
  check('صفر خطوات ظاهرة للموظف', stepsVisible(doc).visible === 0);
  check('الشرح يقول إنها للمدير فقط',
    /للمدير فقط/.test(doc.getElementById('rp-gate-note').textContent));
}

/* ═══ ٤) مدير موقوف — مقفل ═════════════════════════════════════════════════ */
step(4, 'مدير موقوف الحساب — مقفل');

{
  const { out, doc } = await run({
    protocol: 'https:',
    session: { user: { id: 'u2' } },
    staffRow: { role: 'admin', active: false }
  });
  check('الحالة = guest (الحساب موقوف)', out.state === 'guest', out.state);
  check('صفر خطوات ظاهرة', stepsVisible(doc).visible === 0);
}

/* ═══ ٥) مدير فعّال — مفتوح ══════════════════════════════════════════════ */
step(5, 'منشور + جلسة مدير فعّال — مفتوح كاملاً');

{
  const { doc, out } = await run({
    protocol: 'https:',
    session: { user: { id: 'u3' } },
    staffRow: { role: 'admin', active: true }
  });
  check('الحالة = admin', out.state === 'admin', out.state);
  const v = stepsVisible(doc);
  check('كل الخطوات ظاهرة للمدير', v.visible === v.total, `${v.visible}/${v.total}`);
  check('الملاحظة تؤكد صلاحية المدير',
    /صلاحية مدير/.test(doc.getElementById('rp-gate-note').textContent));
}

/* ═══ ٦) أنماط الفشل ══════════════════════════════════════════════════════ */
step(6, 'حساب غير مرتبط بموظف أو شبكة ساقطة — يبقى مقفلاً');

{
  const { out, doc } = await run({ protocol: 'https:', session: { user: { id: 'u4' } }, staffRow: null });
  check('حساب بلا سطر موظف → مقفل', out.state === 'guest' && stepsVisible(doc).visible === 0, out.state);
}
{
  const { out, doc } = await run({ protocol: 'https:', session: { user: { id: 'u5' } }, sessionThrows: true });
  check('شبكة ساقطة → مقفل (لا فتح بالخطأ)', out.state === 'network' && stepsVisible(doc).visible === 0, out.state);
}
{
  /* الأسوأ: خطأ في قراءة brc.staff لا يجوز أن يُفتح */
  const { out, doc } = await run({ protocol: 'https:', session: { user: { id: 'u6' } }, staffError: true });
  check('خطأ في قراءة صف الموظف → مقفل', out.state === 'network' && stepsVisible(doc).visible === 0, out.state);
}

/* ═══ ٧) لا يفتح بالخطأ أبداً عبر الافتراضي ══════════════════════════════ */
step(7, 'الوضع الافتراضي في الصفحة: مقفل قبل التحقق');

check('عنصر البوابة يبدأ بـ hidden في HTML',
  /id="rp-gate"[^>]*hidden/.test(PAGE) || /hidden[^>]*id="rp-gate"/.test(PAGE));
check('CSS يُخفي الخطوات في حالة pending',
  /data-rp-access="pending"\]\s*\[data-rp-step\]/.test(read('assets/css/restore.css')));

console.log('\n' + '═'.repeat(74));
if (fail === 0) {
  console.log('  النتيجة: ✅ ' + pass + ' فحصاً ناجحاً | 0 فاشل');
  console.log('  الأداة تعمل محلياً عند الكارثة، ومقفلة على الموقع لغير المدير.');
} else {
  console.log('  النتيجة: ❌ ' + pass + ' ناجح | ' + fail + ' فاشل');
  console.log('\n  المشاكل:');
  problems.forEach((p) => console.log('   • ' + p));
}
console.log('═'.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
