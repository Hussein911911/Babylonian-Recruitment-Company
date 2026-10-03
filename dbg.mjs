import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
const ROOT = process.cwd();
const DEMO_SEED = (await import('./tests/fixtures/demo-seed.mjs')).DEMO_SEED;
const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); ['log','info','warn','error'].forEach(k => vc.on(k, () => {}));
const dom = await JSDOM.fromFile(ROOT + '/index.html', {
  url: pathToFileURL(ROOT + '/index.html').href + '#card=HRC-BC-284651',
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.__HRC_TEST_SEED__ = JSON.parse(JSON.stringify(DEMO_SEED));
    Object.defineProperty(w, 'print', { configurable: true, writable: true, value: () => {} });
  },
});
const w = dom.window, doc = w.document;
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(2500);
const modal = () => { const ms = doc.querySelectorAll('.bk-wrap,[data-bk-root],.modal'); return ms[ms.length-1] || doc.body; };
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
let box = modal();
setVal(box.querySelector('#bk-posName'), 'نقطة تجربة'); click(box.querySelector('#bk-pos-next')); await wait(200);
setVal(modal().querySelector('#bk-fullName'), 'تجربة عميل'); click(modal().querySelector('#bk-pos-next')); await wait(200);
setVal(modal().querySelector('#bk-phone'), '07700000000'); click(modal().querySelector('#bk-pos-next')); await wait(200);
setVal(modal().querySelector('#bk-address'), 'الحلة'); click(modal().querySelector('#bk-pos-next')); await wait(200);
click(modal().querySelector('#bk-pos-next')); await wait(200);
box = modal();
console.log('خطوة 6: بطاقات =', box.querySelectorAll('[data-bk-pick]').length, '| أكواد:', [...box.querySelectorAll('[data-bk-pick]')].map(c => c.getAttribute('data-bk-pick')).join(','));
click(box.querySelector('[data-bk-pick="HRC-1046"]')); await wait(250);
box = modal();
console.log('is-picked:', box.querySelector('[data-bk-pick="HRC-1046"]').classList.contains('is-picked'));
click(box.querySelector('#bk-pos-next')); await wait(300);
console.log('بعد التالي: view =', w.HRCBooking.state().view);
box = modal();
console.log('شاشة المراجعة؟', /مراجعة/.test(box.textContent), '| رجوع؟', !!box.querySelector('#bk-pos-back'));
click(box.querySelector('#bk-pos-back')); await wait(300);
console.log('بعد الرجوع: view =', w.HRCBooking.state().view, '| posStep =', w.HRCBooking.state().posStep);
box = modal();
const card = box.querySelector('[data-bk-pick="HRC-1046"]');
console.log('البطاقة؟', !!card, '| is-picked =', card && card.classList.contains('is-picked'));
console.log('job-sum:', box.querySelector('#bk-job-sum') && box.querySelector('#bk-job-sum').textContent.slice(0, 40));
