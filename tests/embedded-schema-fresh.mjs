/* ═══ هل النسخة المضمّنة في restore.html مطابقة للمصدر؟ ═══════════════════
   عطل حقيقي وقع 2026-11-17 وكشفه اختبار الزر في متصفح:

   أصلحنا منح التسلسلات في docs/schema.sql، لكن restore.html يحمل نسخة
   **مضمّنة** من الهيكل (ليعمل بلا إنترنت). وتلك النسخة بقيت قديمة.
   فالملف الكامل الذي ينزّله المالك من الصفحة كان ينشئ job_code_seq
   و form_serial_seq **بلا منح** — أي نفس عطل «لا صلاحية كافية» يعود من
   الباب الذي أغلقناه. والقاعدة تبدو سليمة تماماً حتى تفشل أول وظيفة.

   `npm run test:schema` يقارن ملف الـmigration فقط، فلم يكشف هذا.
   هذا الفحص يقارن الصفحة نفسها. */
import { readFileSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

const schema = readFileSync('docs/schema.sql', 'utf8');
const html = readFileSync('restore.html', 'utf8');

const m = html.match(/id="hrc-schema-embed"[^>]*>([\s\S]*?)<\/script>/);
check('وُجد وسم الهيكل المضمّن', !!m);
if (!m) { console.log('\n❌ لا شيء لفحصه'); process.exit(1); }

let embedded = m[1].trim();
if (embedded.charAt(0) === '"') {
  try { embedded = JSON.parse(embedded); } catch (e) {}
}

console.log('\n═══ الحجم ═══');
check('المضمّن ليس فارغاً', embedded.length > 100000, embedded.length + ' حرفاً');
/* فرق بسيط مقبول (الهيكل يُضمَّن بلا فواصل)، لكن الفرق الكبير يعني قدماً */
const diff = Math.abs(embedded.length - schema.length);
check('الحجم مقارب للمصدر', diff < 5000, 'المصدر ' + schema.length + ' والمضمّن ' + embedded.length);

console.log('\n═══ منح التسلسلات — أصل عطل المالك ═══');
/* لكل تسلسل: إن كان ممنوحاً في المصدر يجب أن يكون ممنوحاً في المضمّن */
const seqs = ['audit_log_id_seq', 'job_code_seq', 'form_serial_seq'];
for (const s of seqs) {
  const pat = new RegExp('grant[^;]*on\\s+sequence\\s+brc\\.' + s + '[^;]*authenticated', 'i');
  const inSource = pat.test(schema);
  const inEmbed = pat.test(embedded);
  check(`${s}: منح في المصدر`, inSource, 'مفقود من docs/schema.sql');
  check(`${s}: منح في المضمّن`, inEmbed, 'المضمّن قديم — شغّل npm run schema:embed');
  check(`${s}: متطابقان`, inSource === inEmbed, 'انحراف بين المصدر والصفحة');
}

console.log('\n═══ إصلاحات لا يجوز أن تضيع ═══');
const mustHave = [
  ['منح usage/select/update على التسلسلات', /grant usage, select, update on sequence/i],
  ['next_job_code بـsecurity definer', /create or replace function brc\.next_job_code[\s\S]{0,200}security definer/i],
  ['view working_applicants بعمود card_number', /brc\.card_number_for\(a\.serial\) as card_number/i],
];
for (const [label, pat] of mustHave) {
  check(label + ' — في المصدر', pat.test(schema));
  check(label + ' — في المضمّن', pat.test(embedded), 'شغّل npm run schema:embed');
}

console.log('\n═══ الصفحة تحمّل مولّد الملف الكامل ═══');
check('full-dump.js محمّل', /src="assets\/js\/full-dump\.js"/.test(html), 'الزر لن يعمل');
check('restore-sql.js محمّل', /src="assets\/js\/restore-sql\.js"/.test(html));
check('زر الملف الكامل موجود', /id="rp-dl-full"/.test(html));

console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — النسخة المضمّنة مطابقة` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
