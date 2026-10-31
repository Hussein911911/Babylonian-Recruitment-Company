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
assert.match(read('assets/js/voucher.js'), /width:59\.4mm;height:94\.6mm/);
console.log('Brand consistency: site, dashboard, favicon, application form, both card faces and printable paths passed.');
