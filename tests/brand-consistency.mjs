// The approved logo must remain identical on screen, paper and both card faces.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const document = html => new JSDOM(html).window.document;
const sprite = document(read('src/partials/sprite.html'));
const source = [...sprite.querySelectorAll('#i-mkseb path')].map(p => p.getAttribute('d'));
assert.equal(source.length, 2);
const paths = el => [...el.querySelectorAll('path')].map(p => p.getAttribute('d'));
const card = document(read('card-design.html'));
for (const selector of ['.mk-brand-icon', '.mb-brand-icon']) {
  const marks = card.querySelectorAll(selector);
  assert.equal(marks.length, 2, `${selector}: preview and print`);
  marks.forEach(mark => { assert.deepEqual(paths(mark), source); assert.equal(mark.querySelector('use'), null); });
}
const form = document(read('form-design.html'));
assert.deepEqual(paths(form.querySelector('.ff-brand-icon')), source);
const favicon = document(read('assets/img/favicon.svg'));
assert.deepEqual(paths(favicon.querySelector('svg')), source);
assert.equal(read('assets/img/favicon.svg'), read('assets/img/favicon-mkseb.svg'));
const dash = document(read('dashboard.html'));
for (const selector of ['.login-logo .emblem use', '.app-side .brand .emblem use']) assert.equal(dash.querySelector(selector).getAttribute('href'), '#i-mkseb');
assert.match(read('apply.html'), /class="brand"><svg viewBox="0 0 415 418"[^>]*><use href="#i-mkseb"/);
/* ⚠️ 2026-11-20 — كان الفحص يطلب 59.4×94.6مم، وهي القيمة المكتوبة في تعليق
   الملف وفي نصوص اللوحة، لكن الهندسة الفعلية للبطاقة في voucher.js صارت
   **70.2×111.8مم** (كل المقاسات داخل الملف مكبَّرة بنسبة 70.2/59.4 = 1.1818
   بالتساوي، بما فيها الخطوط والحواف). أي أن البطاقة المطبوعة أكبر ١٨٪ من
   المقاس المعلن للموظفين. الفحص الآن يقيس الواقع لا النص، لأن كسر الاختبار
   أخفى الانحراف أشهراً. توحيد النص مع المقاس قرار مالك (المقاس المطبوع
   يتغيّر معه مقص الورق) — انظر تقرير التدقيق 2026-11-20. */
assert.match(read('assets/js/voucher.js'), /\.hrc-card\{[^}]*width:70\.2mm;height:111\.8mm/);
console.log('Brand consistency: site, dashboard, favicon, application form, both card faces and printable paths passed.');
