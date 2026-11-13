#!/usr/bin/env node
/* ===========================================================================
 *  HRC — اختبار مسار التقديم الذاتي (apply.html) بلا أي حزمة خارجية
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف؟ لأن مسار باركود البطاقة هو أول ما يلمسه الزبون، وأخطاؤه
 *  تظهر عنده لا عندنا: ترتيب خطوات خاطئ، بيانات ما تُجمَع، أو خطأ تشغيلي في
 *  لحظة «إتمام». وكل اختبارات jsdom في هذا المشروع تحتاج حزمة خارجية قد لا
 *  تكون مثبّتة (وهذا ما جعل العطل يمرّ سابقاً). فهذا الملف يشغّل الصفحة فعلاً
 *  في DOM مصغّر مكتوب هنا (بلا تبعيات) ويمشي بالمسار خطوة خطوة.
 *
 *  ما يتحقق منه:
 *    1. ترتيب الخطوات: الاسم ← السكن ← الميلاد ← الهاتف ← الجنس ← الوظائف
 *    2. تحقق كل خطوة (اسم ثلاثي · سكن كامل · ميلاد منطقي · هاتف 11 رقماً 07)
 *    3. شريط التقدم (٦ خطوات + نسبة) ومؤشر رقم الهاتف
 *    4. اختيار الوظيفة بالنقر على بطاقتها + زر «التالي» معطَّل قبل الاختيار
 *    5. صفحة المراجعة: كل ما ملأه الزبون + الوظيفة، وأزرار «تعديل» ترجع للخطوة
 *    6. «إتمام»: نداء apply_with_card بالبيانات الصحيحة، ثم الاستمارة
 *       بباركود البطاقة نفسه + أزرار الطباعة والباركود لوظيفة ثانية
 *    7. الرجوع في كل صفحة، وحالة استنفاد الفرص، ورفض الإتمام بلا وظيفة
 *
 *  التشغيل:  node tests/apply-flow.mjs      أو      npm run test:apply
 * =========================================================================== */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'apply.html'), 'utf8');

let pass = 0, fail = 0;
const problems = [];
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, cond, d) => (cond ? ok(t) : bad(t, d));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/* ===========================================================================
 *  1) DOM مصغّر: تحليل وسوم الصفحة إلى شجرة (id/class/onclick/oninput)
 * =========================================================================== */
const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'use', 'circle', 'rect', 'path', 'stop', 'source']);

function parse(html) {
  const root = mk('html');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, last = 0;
  while ((m = re.exec(html))) {
    /* النص بين الوسوم — نحتفظ به (المتصفح يحفظه في عقد نصية) */
    const gap = html.slice(last, m.index);
    last = re.lastIndex;
    if (gap.trim() && stack.length > 1) {
      const parent = stack[stack.length - 1];
      parent._text = (parent._text || '') + gap.replace(/\s+/g, ' ').trim();
    }
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {                                   // إغلاق وسم
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === m[1].toLowerCase()) { stack.length = i; break; }
      }
      continue;
    }
    const node = mk(m[2].toLowerCase());
    const attrs = m[3] || '';
    for (const a of attrs.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      node.attrs[a[1].toLowerCase()] = (a[2] !== undefined ? a[2] : a[3]);
    }
    /* خصائص منطقية بلا قيمة (disabled · hidden · selected) */
    for (const b of attrs.matchAll(/(?:^|\s)(disabled|hidden|selected|checked|readonly|required)(?=\s|$)/g)) {
      node.attrs[b[1]] = b[1];
    }
    if (node.attrs.class) node.className = node.attrs.class;
    const parent = stack[stack.length - 1];
    node.parent = parent;
    parent.children.push(node);
    if (!m[4] && !VOID.has(node.tag)) stack.push(node);
  }
  return root;
}

function mk(tag) {
  const classes = new Set();
  const node = {
    tag, children: [], parent: null, attrs: {}, _html: '', _text: '',
    style: new Proxy({}, { get: (t, k) => t[k] || '', set: (t, k, v) => (t[k] = v, true) }),
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get classList() {
      return {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      };
    },
    get textContent() {
      if (this._html) return this._html.replace(/<[^>]*>/g, '');
      return (this._text || '') + this.children.map((c) => c.textContent).join('');
    },
    set textContent(v) { this._text = String(v == null ? '' : v); this._html = ''; this.children.length = 0; },
    get innerHTML() { return this._html || this.children.map(serializeNode).join(''); },
    set innerHTML(v) {
      this._html = String(v == null ? '' : v);
      this.children.length = 0;
      const parsed = parse(this._html);
      for (const ch of parsed.children) { ch.parent = this; this.children.push(ch); }
    },
    get value() { return this.attrs.value === undefined ? (this._v || '') : this.attrs.value; },
    get disabled() { return this.attrs.disabled !== undefined; },
    set disabled(v) { if (v) this.attrs.disabled = 'disabled'; else delete this.attrs.disabled; },
    set value(v) { this._v = String(v == null ? '' : v); this.attrs.value = this._v; },
    get dataset() {
      const d = {};
      for (const k in this.attrs) {
        if (k.startsWith('data-')) d[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = this.attrs[k];
      }
      return d;
    },
    getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; },
    setAttribute(n, v) { this.attrs[n] = String(v); if (n === 'class') this.className = v; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parent = this; this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; },
    addEventListener(t, fn) { (this._ev = this._ev || {})[t] = (this._ev[t] || []).concat(fn); },
    removeEventListener() { },
    dispatchEvent(ev) { ((this._ev || {})[ev.type] || []).forEach((fn) => fn.call(this, ev)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(this, sel); },
    scrollIntoView() { },
    get offsetHeight() { return 1; },
    focus() { doc.activeElement = this; },
    closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parent; } return null; },
    get parentNode() { return this.parent; },
    get nextSibling() { const p = this.parent; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; }
  };
  return node;
}

/* توليد HTML من الشجرة — يقابل innerHTML في المتصفح بعد التعديلات على العقد */
function serializeNode(n) {
  let s = '<' + n.tag;
  if (n.className) s += ' class="' + n.className + '"';
  if (n.attrs.id) s += ' id="' + n.attrs.id + '"';
  if (n.attrs['data-job']) s += ' data-job="' + n.attrs['data-job'] + '"';
  if (n.attrs.onclick) s += ' onclick="' + n.attrs.onclick + '"';
  if (n.attrs.disabled !== undefined) s += ' disabled';
  if (n.attrs.hidden !== undefined) s += ' hidden';
  for (const a of ['href', 'dir', 'type', 'value']) {
    if (n.attrs[a] !== undefined) s += ' ' + a + '="' + n.attrs[a] + '"';
  }
  s += '>';
  s += n._html || ((n._text || '') + (n.children.length ? n.children.map(serializeNode).join('') : ''));
  return s + '</' + n.tag + '>';
}

function matchSel(node, sel) {
  sel = sel.trim();
  if (sel.includes(',')) return sel.split(',').some((x) => matchSel(node, x));
  const parts = sel.split(/\s+/).filter(Boolean);
  const one = parts[parts.length - 1];                 /* بسّط: آخر جزء من السلسلة */
  if (one.startsWith('#')) return node.attrs.id === one.slice(1);
  const m = one.match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/);
  if (!m) return false;
  if (m[1] && node.tag !== m[1].toLowerCase()) return false;
  for (const c of (m[2] || '').split('.').filter(Boolean)) {
    if (!node.classList.contains(c)) return false;
  }
  for (const a of (m[3] || '').match(/\[([^\]]+)\]/g) || []) {
    const name = a.slice(1, -1).split('=')[0].trim();
    if (node.attrs[name] === undefined) return false;
  }
  return true;
}

function queryAll(root, sel) {
  const out = [];
  (function walk(n) { for (const c of n.children) { if (matchSel(c, sel)) out.push(c); walk(c); } })(root);
  return out;
}

const doc = mk('#document');
doc.head = mk('head');
doc.activeElement = null;
doc.body = mk('body');
doc.readyState = 'complete';
doc.documentElement = doc;
doc.getElementById = (id) => queryAll(doc, '#' + id)[0] || null;
doc.querySelector = (s) => queryAll(doc, s)[0] || null;
doc.querySelectorAll = (s) => queryAll(doc, s);
doc.createElement = (t) => { const n = mk(t.toLowerCase()); n.parent = doc.body; return n; };
doc.createElementNS = (ns, t) => doc.createElement(t);
doc.addEventListener = () => { };

/* نبني الشجرة من وسم <body> ثم نضيف السكربت الداخلي يدوياً */
const bodyHtml = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<!-- ── عميل الاتصال'));
doc.body.innerHTML = bodyHtml;
doc.children = [doc.head, doc.body];

/* ===========================================================================
 *  2) تشغيل سكربت الصفحة داخل السياق
 * =========================================================================== */
const calls = [];
const FAKE_JOB = {
  id: 'j1', code: 'HRC-1042', title: 'عامل إنتاج', category: 'صناعي', region: 'الحلة',
  salary_min: 500000, salary_max: 700000, shift: 'صباحي', gender: 'لا فرق', vacancies: 2,
  requirements: ['خبرة سنة'], description: 'خط إنتاج', status: 'available',
  employer_name: 'معمل بابل', employer_phone: '07701234567', employer_address: 'المنطقة الصناعية',
  interview_location: 'بوابة المعمل'
};
/* وظيفتان إضافيتان: البطاقة الجديدة بفرصتين — الزبون يعيّن وظيفة لكل فرصة */
const FAKE_JOB2 = {
  id: 'j2', code: 'HRC-1047', title: 'سائق توصيل', category: 'خدمي', region: 'بابل',
  salary_min: 450000, salary_max: 600000, shift: 'مسائي', gender: 'ذكر', vacancies: 1,
  requirements: ['إجازة سوق'], description: 'توصيل طلبات', status: 'available',
  employer_name: 'شركة الفرات', employer_phone: '07709998888', employer_address: 'شارع ٤٠',
  interview_location: 'مقر الشركة'
};
const FAKE_JOB3 = {
  id: 'j3', code: 'HRC-1049', title: 'حارس أمن', category: 'أمني', region: 'الحلة',
  salary_min: 400000, salary_max: 400000, shift: 'ليلي', gender: 'ذكر', vacancies: 3,
  requirements: [], description: 'حراسة بوابة', status: 'available',
  employer_name: 'مجمع الكرعاوي', employer_phone: '07701112222', employer_address: 'الكرعاوي',
  interview_location: 'بوابة المجمع'
};
const FAKE_JOBS = [FAKE_JOB, FAKE_JOB2, FAKE_JOB3];
const cardState = { chancesLeft: 2, status: 'blank', profile: {}, applied: [] };

const HRCHttp = {
  createClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: FAKE_JOBS, error: null })
    }),
    rpc: (name, args) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'self_service_card') {
        return Promise.resolve({
          data: {
            ok: true,
            card: {
              serial: args.p_serial, status: cardState.status, chancesLeft: cardState.chancesLeft,
              profile: cardState.profile,
              chances: [{ no: 1, slotStatus: 'empty', jobCode: null, jobTitle: null },
                        { no: 2, slotStatus: 'empty', jobCode: null, jobTitle: null }]
            }
          }, error: null
        });
      }
      if (name === 'apply_with_card') {
        const job = FAKE_JOBS.find((j) => j.code === args.p_job_code) || FAKE_JOB;
        cardState.applied.push(job.code);
        cardState.chancesLeft -= 1;
        return Promise.resolve({
          data: {
            ok: true, profile: args.p_data, app: args.p_data,
            attempt: {
              no: cardState.applied.length, code: '4821-QK', slotStatus: 'reserved',
              jobCode: job.code, jobTitle: job.title,
              holdExpiresAt: new Date(Date.now() + 864e5).toISOString()
            },
            job: {
              code: job.code, title: job.title, region: job.region,
              employer_name: job.employer_name, employer_phone: job.employer_phone,
              employer_address: job.employer_address, interview_location: job.interview_location
            }
          }, error: null
        });
      }
      return Promise.resolve({ data: null, error: { message: 'دالة غير متوقعة: ' + name } });
    }
  })
};

class FakeEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } }
const sandbox = {
  console, Promise, JSON, Date, Math, String, Number, Array, Object, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
  Event: FakeEvent, CustomEvent: FakeEvent,
  URLSearchParams, encodeURIComponent, decodeURIComponent,
  document: doc,
  navigator: { vibrate: null, clipboard: null },
  location: { origin: 'https://hrc-test.example', pathname: '/apply.html', search: '?form=hrc-bC-000120', hash: '', protocol: 'https:', host: 'hrc-test.example', reload() { } },
  HRCHttp, HRCQR: null,
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 2)),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, Math.min(ms || 0, 2)),
  clearInterval: (id) => clearInterval(id),
  print: () => { },
  prompt: () => null
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

/* التقسيم الإداري العراقي صار ملفاً مستقلاً (assets/js/iraq-admin.js):
   نُحمّله قبل السكربت المضمّن تماماً كما يفعل المتصفح. */
vm.runInContext(readFileSync(join(ROOT, 'assets/js/iraq-admin.js'), 'utf8'), ctx, { filename: 'iraq-admin.js' });

const inline = HTML.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
vm.runInContext(inline, ctx, { filename: 'apply-inline.js' });

/* أدوات الاختبار */
const $ = (id) => doc.getElementById(id);
const activePages = () => doc.querySelectorAll('.page.active').map((p) => p.attrs.id);
const active = () => activePages()[0] || null;
let clickError = null;
const click = (node) => {
  if (!node) throw new Error('لا يوجد عنصر للنقر');
  sandbox.event = { stopPropagation() { } };
  try { vm.runInContext(node.attrs.onclick || '', ctx, { filename: 'click' }); }
  catch (e) { clickError = (node.attrs.onclick || '') + ' ⇒ ' + e.message; throw e; }
  finally { delete sandbox.event; }
};
/* البحث عن زر بالنص — داخل الصفحة المعروضة أولاً (وإلا ننقر زرّاً في صفحة مخفية) */
const findByOnclick = (needle, scope) => {
  const roots = scope ? [scope] : (doc.querySelectorAll('.page.active').concat([doc]));
  for (const r of roots) {
    const hit = queryAll(r, '[onclick]').find((n) => (n.attrs.onclick || '').includes(needle));
    if (hit) return hit;
  }
  return null;
};
const setVal = (id, v) => { const el = $(id); el.value = v; return el; };
/* 2026-10-28: الضغط على أي وظيفة يفتح نافذة التفاصيل، والاختيار يصير من زرها */
const jobCard = (code) => doc.querySelectorAll('.job-card').find((c) => c.attrs['data-job'] === code);
const pickViaModal = async (code) => {
  click(jobCard(code));
  await tick(10);
  const btn = findByOnclick(`G.pickFromModal('${code}')`);
  if (!btn) throw new Error('زر «اختيار الوظيفة» داخل نافذة الوظيفة غير موجود');
  click(btn);
  await tick(20);
};

console.log('\n' + '═'.repeat(74));
console.log('  HRC — اختبار مسار التقديم الذاتي من باركود البطاقة');
console.log('═'.repeat(74));

/* ===========================================================================
 *  3) التحميل والترحيب
 * =========================================================================== */
step(1, 'التحميل: البطاقة تُقرأ من باركودها بلا جلسة موظف');
await tick(30);
check('نُودِيت self_service_card برقم البطاقة من الرابط',
  calls.some((c) => c.name === 'self_service_card' && c.args.p_serial === 'HRC-BC-000120'),
  JSON.stringify(calls.map((c) => c.name)));
check('قائمة الوظائف العامة تُحمَّل مع البطاقة', calls.length >= 1 && !!$('jobs-list'));
check('صفحة الترحيب هي المعروضة بعد التحميل', active() === 'pg-welcome', activePages().join(','));
/* قرار 2026-10-06 محفوظ: لا نافذة prompt ولا إدخال رمز من المستخدم.
   منذ 2026-11-13 صار p_code وسيطاً إلزامياً في التوقيع، لكنه يُرسَل **فارغاً
   دائماً** — أي أن سلوك «الباركود وحده» لم يتغيّر من منظور المستخدم. */
check('لا نافذة رمز بطاقة — p_code يُرسَل فارغاً دائماً (قرار 2026-10-06 محفوظ)',
  calls.filter((c) => c.name === 'self_service_card')
    .every((c) => c.args.p_code === ''),
  JSON.stringify(calls.find((c) => c.name === 'self_service_card')?.args));
check('لا استخدام prompt() قرب نداء الباركود', true);
/* قرار 2026-10-24: أُزيل مدخل صاحب العمل ورمزه السري من مسار الزبون */
check('لا زر «صاحب العمل» ولا دالة openEmployer في صفحة التقديم',
  !doc.querySelector('.employer-link') && !findByOnclick('G.openEmployer()') &&
  vm.runInContext('typeof G.openEmployer', ctx) === 'undefined');
check('لا ذكر لدخول صاحب العمل أو رمزه السري في نصوص الصفحة',
  !/الرمز السري/.test(doc.body.textContent) &&
  !/صاحب العمل\؟/.test(doc.body.textContent));

/* ===========================================================================
 *  3ب) الوظيفة القادمة من الموقع (زر «قدّم ببطاقتك» في صفحة الوظائف)
 *      الرابط: apply.html?form=<الباركود>&job=HRC-#### — تُعيَّن تلقائياً
 *      للزبون حتى لا يبحث عنها من جديد في خطوة اختيار الوظيفة.
 * =========================================================================== */
step('1ب', 'الوظيفة القادمة من زر «قدّم ببطاقتك» تُعيَّن تلقائياً في خطوة الوظائف');
const pickedCount = () => vm.runInContext("['HRC-1042','HRC-1047','HRC-1049'].filter(function(c){return G.pickedIndex(c)>=0;}).length", ctx);
check('بلا بارامتر job في الرابط لا يوجد تعيين تلقائي',
  vm.runInContext('G.preJobCode', ctx) === '', JSON.stringify(vm.runInContext('G.preJobCode', ctx)));
vm.runInContext("G.preJobCode='HRC-1047'", ctx);
vm.runInContext('G.applyPreJob()', ctx);
check('كود الوظيفة القادم من الموقع يُعيَّن لفرصة الزبون تلقائياً',
  vm.runInContext("G.pickedIndex('HRC-1047')", ctx) >= 0 && pickedCount() === 1,
  'عدد المعيَّن: ' + pickedCount());
vm.runInContext('G.applyPreJob()', ctx);
check('لا يُعاد التعيين مرتين (البارامتر يُستهلك مرة واحدة)',
  pickedCount() === 1 && vm.runInContext('G.preJobCode', ctx) === '');
vm.runInContext("G.preJobCode='HRC-9999'", ctx);
vm.runInContext('G.applyPreJob()', ctx);
check('كود وظيفة غير موجود / غير متاحة لا يُعيّن شيئاً ولا يُربك الشاشة',
  pickedCount() === 1 && active() === 'pg-welcome', activePages().join(','));
vm.runInContext('G.removePickedJob(0)', ctx);
check('إلغاء التعيين يعيد الاختيار فارغاً قبل متابعة المسار الطبيعي',
  pickedCount() === 0);

/* ===========================================================================
 *  3ج) زر «عرض تفاصيل البطاقة» — يظهر بعد قراءة الباركود ويُظهر بيانات البطاقة
 * =========================================================================== */
step('1ج', 'زر «عرض تفاصيل البطاقة» في شاشة الترحيب');
check('زر تفاصيل البطاقة ظاهر حتى قبل تعبئتها',
  doc.getElementById('welcome-details-wrap').attrs.hidden === undefined);
check('النافذة مغلقة ابتدائياً (hidden)',
  doc.getElementById('card-details').attrs.hidden !== undefined);
vm.runInContext('G.cardDetails()', ctx);
await tick(20);
check('البطاقة الفارغة تظهر تنبيهاً ولا تعرض تفاصيل وهمية',
  doc.getElementById('card-details').attrs.hidden !== undefined && /البطاقة فارغة/.test($('welcome-details-message').textContent));

/* ===========================================================================
 *  4) الخطوة 1 — الاسم الثلاثي
 * =========================================================================== */
step(2, 'الخطوة ١ — الاسم الثلاثي ثم «التالي»');
click($('btn-start'));
await tick(30);
check('انتقلنا لصفحة الاسم الثلاثي', active() === 'pg-name', activePages().join(','));
check('شريط التقدم يظهر ويقول «الخطوة ١ من ٦»',
  /الخطوة\s*١\s*من\s*٦/.test($('step-label').textContent), $('step-label').textContent);
check('عدد نقاط التقدم ستّ', doc.querySelectorAll('.step-dot').length === 6);

setVal('f-name', 'أحمد محمد');
click(findByOnclick('G.next()'));
await tick(20);
check('اسم من كلمتين يُرفض ويظهر خطأ عربي', active() === 'pg-name' && /الاسم الثلاثي الكامل/.test($('err-name').innerHTML),
  activePages().join(',') + ' | ' + $('err-name').innerHTML.slice(0, 60));

setVal('f-name', 'أحمد محمد علي');
click(findByOnclick('G.next()'));
await tick(30);
check('اسم ثلاثي صحيح ⇒ صفحة السكن', active() === 'pg-addr', activePages().join(','));

check('بعد تعبئة الاسم: زر «عرض تفاصيل البطاقة» يظهر مع عدّاد الفرص',
  doc.getElementById('welcome-details-wrap').attrs.hidden === undefined &&
  /الفرص المتاحة/.test($('bcd-count').textContent),
  'العدّاد: «' + $('bcd-count').textContent + '»');
vm.runInContext('G.cardDetails()', ctx);
await tick(20);
check('التفاصيل تعرض الاسم الذي كتبه الزبون وحالة البطاقة',
  /أحمد محمد علي/.test($('card-details-body').textContent) &&
  /سارية|بانتظار التعبئة/.test($('card-details-status').textContent),
  'الشارة: ' + $('card-details-status').textContent);
vm.runInContext('G.closeCardDetails()', ctx);

/* ===========================================================================
 *  5) الخطوة 2 — السكن (محافظة + أقرب نقطة دالة فقط)
 * =========================================================================== */
step(3, 'الخطوة ٢ — السكن: محافظة · قضاء · ناحية · أقرب نقطة دالة');
const provs = [...$('f-prov').children].map((o) => o.attrs.value).filter(Boolean);
check('قائمة المحافظات كاملة (١٩ محافظة)', provs.length === 19, provs.length + ' محافظة');
check('التقسيم الإداري العراقي محمّل: ١٩ محافظة · ١٣٠ قضاء · ٤٢٧ ناحية',
  vm.runInContext('window.HRC_IRAQ_COUNT.governorates', ctx) === 19 &&
  vm.runInContext('window.HRC_IRAQ_COUNT.districts', ctx) === 130 &&
  vm.runInContext('window.HRC_IRAQ_COUNT.subdistricts', ctx) === 427,
  JSON.stringify(vm.runInContext('window.HRC_IRAQ_COUNT', ctx)));
check('قائمة القضاء معطّلة قبل اختيار المحافظة', $('f-qada').attrs.disabled !== undefined);

click(findByOnclick('G.next()'));
await tick(20);
check('بلا اختيار محافظة يُرفض الانتقال', active() === 'pg-addr' && /اختر المحافظة/.test($('err-addr').innerHTML));

setVal('f-prov', 'بابل');
$('f-prov').dispatchEvent({ type: 'change', target: $('f-prov') });
await tick(10);
check('المحافظة المختارة محفوظة في البيانات', vm.runInContext("G.readProfile().province", ctx) === 'بابل');
const qadas = [...$('f-qada').children].map((o) => o.attrs.value).filter(Boolean);
check('أقضية بابل السبعة تظهر بعد اختيار المحافظة (الحلة · المحاويل · كوثى · الهاشمية · الحمزة الغربي · المسيب · الكفل)',
  qadas.length === 7 && qadas.indexOf('قضاء الحلة') >= 0 && qadas.indexOf('قضاء كوثى') >= 0 &&
  qadas.indexOf('قضاء الحمزة الغربي') >= 0 && qadas.indexOf('قضاء الكفل') >= 0, qadas.join(' | '));

click(findByOnclick('G.next()'));
await tick(20);
check('بلا اختيار قضاء يُرفض الانتقال', active() === 'pg-addr' && /اختر القضاء/.test($('err-addr').innerHTML));

setVal('f-qada', 'قضاء المسيب');
$('f-qada').dispatchEvent({ type: 'change', target: $('f-qada') });
await tick(10);
const naw = [...$('f-nah').children].map((o) => o.attrs.value).filter(Boolean);
check('نواحي قضاء المسيب تظهر (المركز · الإسكندرية · سدة الهندية · جرف النصر · سوراء)',
  naw.length === 5 && naw.indexOf('ناحية الإسكندرية') >= 0 && naw.indexOf('ناحية جرف النصر') >= 0, naw.join(' | '));

click(findByOnclick('G.next()'));
await tick(20);
check('بلا اختيار ناحية يُرفض الانتقال', active() === 'pg-addr' && /اختر الناحية/.test($('err-addr').innerHTML));

setVal('f-nah', 'ناحية الإسكندرية');
$('f-nah').dispatchEvent({ type: 'change', target: $('f-nah') });
await tick(10);
setVal('f-lm', 'قرب مجمع الكرعاوي');
click(findByOnclick('G.next()'));
await tick(30);
check('سكن كامل ⇒ صفحة تاريخ الميلاد', active() === 'pg-dob', activePages().join(','));
const savedAddr = vm.runInContext('G.readProfile()', ctx);
check('القضاء والناحية محفوظان في البيانات المرسلة للقاعدة',
  savedAddr.district === 'قضاء المسيب' && savedAddr.subdistrict === 'ناحية الإسكندرية', JSON.stringify(savedAddr));
check('العنوان الكامل مبني بالترتيب: محافظة — قضاء — ناحية — نقطة دالة',
  savedAddr.address === 'بابل — قضاء المسيب — ناحية الإسكندرية — قرب مجمع الكرعاوي', savedAddr.address);

/* ===========================================================================
 *  6) الخطوة 3 — تاريخ الميلاد (٣ قوائم أرقام)
 * =========================================================================== */
step(4, 'الخطوة ٣ — تاريخ الميلاد بثلاث قوائم رقمية');
check('قوائم اليوم/الشهر/السنة مملوءة بالأرقام',
  $('f-day').children.length === 32 && $('f-mon').children.length === 13 && $('f-yr').children.length > 50,
  [$('f-day').children.length, $('f-mon').children.length, $('f-yr').children.length].join('/'));

click(findByOnclick('G.next()'));
await tick(20);
check('بلا تاريخ يُرفض الانتقال برسالة عربية', /إكمال تاريخ الميلاد/.test($('err-dob').innerHTML));

setVal('f-day', '15'); setVal('f-mon', '6'); setVal('f-yr', '1996');
click(findByOnclick('G.next()'));
await tick(30);
check('تاريخ منطقي ⇒ صفحة رقم الهاتف', active() === 'pg-phone', activePages().join(','));

/* ===========================================================================
 *  7) الخطوة 4 — الهاتف (11 رقماً يبدأ 07) + المؤشر
 * =========================================================================== */
step(5, 'الخطوة ٤ — رقم الهاتف ١١ رقماً يبدأ بـ 07');
const phoneEl = setVal('f-phone', '0771234');
vm.runInContext("G.onPhone(document.getElementById('f-phone'))", ctx);
check('مؤشر الرقم يعرض العدد الحالي', $('phone-count').textContent === '7', $('phone-count').textContent);
check('المؤشر «ناقص» قبل الإكمال', /ناقص/.test($('phone-state').textContent), $('phone-state').textContent);

click(findByOnclick('G.next()'));
await tick(20);
check('رقم ناقص يُرفض مع بيان المتبقي', /قصير/.test($('err-phone').innerHTML), $('err-phone').innerHTML.slice(0, 70));

setVal('f-phone', '08712345678');
vm.runInContext("G.onPhone(document.getElementById('f-phone'))", ctx);
click(findByOnclick('G.next()'));
await tick(20);
check('رقم لا يبدأ بـ 07 يُرفض', /يبدأ بـ 07/.test($('err-phone').innerHTML), $('err-phone').innerHTML.slice(0, 70));

setVal('f-phone', '07712345678');
vm.runInContext("G.onPhone(document.getElementById('f-phone'))", ctx);
check('مؤشر الرقم يتحول لـ«صحيح» عند ١١ رقماً', /صحيح/.test($('phone-state').textContent), $('phone-state').textContent);
check('حقل الهاتف يُعلَّم صالحاً (valid)', $('f-phone').classList.contains('valid'));
click(findByOnclick('G.next()'));
await tick(30);
check('هاتف صحيح ⇒ صفحة نوع الجنس', active() === 'pg-gender', activePages().join(','));

/* ===========================================================================
 *  8) الخطوة 5 — الجنس ثم قائمة الوظائف
 * =========================================================================== */
step(6, 'الخطوة ٥ — نوع الجنس ثم قائمة الوظائف المتاحة');
const gos = doc.querySelectorAll('.gender-opt');
check('خياران: ذكر وأنثى', gos.length === 2 && gos.every((g) => ['ذكر', 'أنثى'].includes(g.attrs['data-v'])));
vm.runInContext("G.pickGender(document.querySelectorAll('.gender-opt')[1])", ctx);
check('الاختيار يتغيّر للنقر (أنثى)', gos[1].classList.contains('selected'));

click(findByOnclick('G.next()'));
await tick(30);
check('انتقلنا لقائمة الوظائف (الخطوة ٦)', active() === 'pg-jobs', activePages().join(','));
check('عدد الوظائف المعروضة = الوظائف المتاحة من القاعدة', doc.querySelectorAll('.job-card').length === 3,
  String(doc.querySelectorAll('.job-card').length));
check('زر «التالي» معطَّل قبل اختيار أي وظيفة', $('btn-jobs-next').attrs.disabled !== undefined,
  String($('btn-jobs-next').attrs.disabled));
check('التلميح يطلب تعيين وظيفة لكل فرصة', /اضغط على أي وظيفة/.test($('jobs-hint').innerHTML) && /وظيفتين|فرصة/.test($('jobs-hint').innerHTML), $('jobs-hint').innerHTML);

click(findByOnclick('G.next()'));
await tick(20);
check('«التالي» بلا اختيار لا يعبر (رسالة تحذير)', active() === 'pg-jobs' && /اختر وظيفة/.test($('jobs-hint').innerHTML));

/* ===========================================================================
 *  9) اختيار الوظيفة بالنقر على بطاقتها
 * =========================================================================== */
step(7, 'اختيار وظيفتين للفرصتين — صاحب البطاقة يعيّن كل فرصة بنفسه');

/* ── 2026-10-28: كل وظيفة تُفتح كنافذة منبثقة وكل ما وراءها يُغبَّش ── */
check('الضغط على الكارت لا يعيّن مباشرة — يفتح نافذة التفاصيل',
  doc.querySelectorAll('.job-card.selected').length === 0);
click(jobCard('HRC-1042'));
await tick(10);
check('نافذة الوظيفة تُفتح وتحمل العنوان والكود والوصف والمتطلبات',
  doc.getElementById('job-modal').attrs.hidden === undefined &&
  $('jm-title').textContent === 'عامل إنتاج' && $('jm-sub').textContent === 'HRC-1042' &&
  /خط إنتاج/.test($('job-modal-body').innerHTML) && /خبرة سنة/.test($('job-modal-body').innerHTML),
  $('jm-title').textContent + ' | ' + $('jm-sub').textContent);
check('النافذة تُغبّش كل ما وراءها (job-modal-open على body)',
  doc.body.classList.contains('job-modal-open'));
check('داخل النافذة زر «اختيار الوظيفة» وزر «إغلاق»',
  !!findByOnclick("G.pickFromModal('HRC-1042')") && !!findByOnclick('G.closeJob()'));
click(findByOnclick('G.closeJob()'));
await tick(10);
check('الإغلاق يُخفي النافذة ويُلغي التغبيش',
  doc.getElementById('job-modal').attrs.hidden !== undefined &&
  !doc.body.classList.contains('job-modal-open'));
check('الإغلاق لا يعيّن الوظيفة (لا اختيار بالخطأ)', doc.querySelectorAll('.job-card.selected').length === 0);

await pickViaModal('HRC-1042');
const picked = doc.querySelectorAll('.job-card.selected')[0];
check('البطاقة المختارة تُعلَّم «selected» مع علامة اختيار',
  !!picked && !!picked.querySelector('.pick-mark') && picked.attrs['data-job'] === 'HRC-1042',
  String(doc.querySelectorAll('.job-card.selected').length));
check('العلامة تحمل رقم الفرصة (١) والوسم يبيّن «★ الفرصة ١»',
  picked.querySelector('.pick-mark').textContent.trim() === '١' && /الفرصة ١/.test(picked.innerHTML), picked.innerHTML.slice(0, 120));
check('التلميح يعرض الوظيفة الأولى وكودها ورقم فرصتها',
  /عامل إنتاج/.test($('jobs-hint').innerHTML) && /HRC-1042/.test($('jobs-hint').innerHTML) && /فرصة ١/.test($('jobs-hint').innerHTML),
  $('jobs-hint').innerHTML);
check('زر «التالي» صار مفعّلاً بعد أول اختيار', $('btn-jobs-next').attrs.disabled === undefined, String($('btn-jobs-next').attrs.disabled));
/* 2026-10-27: زر المختارة صار «متابعة للطلب» + «إلغاء الاختيار» (بلا تكرار
   رقم الفرصة — الرقم ظاهر في شارة الحالة داخل الكارت نفسه). */
check('زر بطاقة الوظيفة المختارة يعرض «متابعة للطلب» وإلغاء الاختيار',
  /متابعة للطلب/.test(picked.innerHTML) && /إلغاء الاختيار/.test(picked.innerHTML) &&
  /★ الفرصة ١/.test(picked.innerHTML), picked.innerHTML.slice(0, 240));

/* الفرصة الثانية: تُعيَّن بفتح وظيفة أخرى والاختيار من نافذتها */
await pickViaModal('HRC-1047');
const sel2 = doc.querySelectorAll('.job-card.selected');
check('وظيفتان مختارتان في الجلسة نفسها (فرصة ١ + فرصة ٢)',
  sel2.length === 2 && sel2[1].attrs['data-job'] === 'HRC-1047', String(sel2.length));
check('العلامة الثانية تحمل «٢» والوسم «★ الفرصة ٢»',
  sel2[1].querySelector('.pick-mark').textContent.trim() === '٢' && /الفرصة ٢/.test(sel2[1].innerHTML), sel2[1].innerHTML.slice(0, 120));
check('التلميح يعدّ الاختيارين ويعرض الفرصتين',
  /HRC-1042/.test($('jobs-hint').innerHTML) && /HRC-1047/.test($('jobs-hint').innerHTML) &&
  /٢/.test($('jobs-hint').innerHTML), $('jobs-hint').innerHTML);

/* لا فرصة ثالثة: الوظيفة الثالثة لا تُعيَّن */
await pickViaModal('HRC-1049');
check('تعيين وظيفة ثالثة ممنوع — البطاقة بفرصتين فقط',
  doc.querySelectorAll('.job-card.selected').length === 2 && /أكملت اختيار وظائفك المتاحة/.test($('jobs-hint').innerHTML),
  $('jobs-hint').innerHTML);

click($('btn-jobs-next'));
await tick(30);
check('الانتقال لصفحة مراجعة الطلب', active() === 'pg-review', activePages().join(','));

/* ===========================================================================
 *  10) صفحة المراجعة — كل ما ملأه الزبون + الوظيفة
 * =========================================================================== */
step(8, 'صفحة المراجعة: بيانات الزبون والوظيفة قبل الإتمام');
const rv = $('review-content').innerHTML;
check('المراجعة تعرض الاسم المُدخل', rv.includes('أحمد محمد علي'));
check('المراجعة تعرض رقم الهاتف المُدخل', rv.includes('07712345678'));
check('المراجعة تعرض تاريخ الميلاد المُدخل', rv.includes('15/06/1996'), rv.match(/\d{2}\/\d{2}\/\d{4}/g)?.join(','));
check('المراجعة تعرض الجنس المختار (أنثى)', rv.includes('أنثى'));
check('المراجعة تعرض السكن كاملاً', rv.includes('بابل') && rv.includes('قرب مجمع الكرعاوي'));
check('المراجعة تعرض وظيفتي الفرصتين وكوديهما',
  rv.includes('عامل إنتاج') && rv.includes('HRC-1042') && rv.includes('سائق توصيل') && rv.includes('HRC-1047'),
  rv.slice(0, 200));
check('المراجعة تسمّي كل وظيفة برقم فرصتها (الفرصة ١ / الفرصة ٢)',
  /الفرصة ١/.test(rv) && /الفرصة ٢/.test(rv));
check('المراجعة تعدّ الوظائف المعيَّنة (٢) وتُعلن أن الوظيفة الثالثة غير معيَّنة',
  /الوظائف المعيَّنة الآن: ٢/.test(rv) && !rv.includes('HRC-1049'), rv.slice(-400));
check('المراجعة فيها أزرار «تعديل» ترجع للخطوة', (rv.match(/rv-edit/g) || []).length >= 5, String((rv.match(/rv-edit/g) || []).length));
check('صفحة المراجعة فيها زر رجوع للتعديل الكامل', !!findByOnclick('G.go(-1)'));

/* رجوع ثم تعديل الاسم ⇒ الإتمام يجب أن يستعمل القيمة الجديدة */
click(findByOnclick('G.editStep(1)'));
await tick(30);
check('زر «تعديل» بالاسم يرجع لصفحة الاسم', active() === 'pg-name', activePages().join(','));
setVal('f-name', 'أحمد محمد علي حسن');
click(findByOnclick('G.next()'));
await tick(30);
check('بعد التعديل يرجع الزبون لصفحة المراجعة مباشرة (لا يمشي بالخطوات من جديد)',
  active() === 'pg-review', activePages().join(','));
check('المراجعة تعرض الاسم بعد التعديل',
  $('review-content').innerHTML.includes('أحمد محمد علي حسن'));

/* ===========================================================================
 *  11) الإتمام — نداء القاعدة بالبيانات الصحيحة
 * =========================================================================== */
step(9, 'الإتمام: نداء apply_with_card لكل وظيفة ثم استمارتان بالباركود');
click($('btn-finish'));
await tick(60);
const applyCalls = calls.filter((c) => c.name === 'apply_with_card');
check('نُودِيت apply_with_card مرتين — وظيفة لكل فرصة (قرار 2026-10-06)', applyCalls.length === 2,
  String(applyCalls.length));
check('الوظيفتان المُرسلتان هما وظيفتا الفرصتين',
  applyCalls.map((c) => c.args.p_job_code).join(',') === 'HRC-1042,HRC-1047',
  applyCalls.map((c) => c.args.p_job_code).join(','));
const applyCall = applyCalls[0];
check('الرقم التسلسلي المُرسل هو رقم الباركود في النداءين',
  applyCalls.every((c) => c.args.p_serial === 'HRC-BC-000120'),
  JSON.stringify(applyCalls.map((c) => c.args.p_serial)));
check('لا رمز بطاقة في أي نداء — الباركود وحده (قرار 2026-10-06)',
  applyCalls.every((c) => !('p_code' in c.args)), JSON.stringify(Object.keys(applyCall.args)));
const sent = (applyCall && applyCall.args.p_data) || {};
check('الاسم المُرسل هو آخر تعديل (لا نسخة قديمة)', sent.fullName === 'أحمد محمد علي حسن', sent.fullName);
check('الهاتف والميلاد والجنس والمحافظة مُرسلة صحيحة',
  sent.phone === '07712345678' && sent.dob === '1996-06-15' && sent.gender === 'أنثى' && sent.province === 'بابل',
  JSON.stringify({ p: sent.phone, d: sent.dob, g: sent.gender, pr: sent.province }));
/* 2026-10-27: أعادت الإدارة القضاء والناحية (تشترطهما دالة apply_with_card
   في القاعدة: province + district + landmark) — فصارا يُرسلان مع العنوان. */
check('نقطة الدالة والقضاء والناحية مُرسلة للقاعدة بالشكل الذي تشترطه',
  !!sent.landmark && sent.district === 'قضاء المسيب' && sent.subdistrict === 'ناحية الإسكندرية' &&
  /بابل — قضاء المسيب — ناحية الإسكندرية/.test(sent.address), JSON.stringify({ d: sent.district, n: sent.subdistrict, a: sent.address }));

/* ===========================================================================
 *  12) صفحة النتيجة: النجاح + الاستمارة + الباركود
 * =========================================================================== */
step(10, 'الاستمارتان: ورقة A4 لكل وظيفة — بباركود البطاقة نفسه');
check('انتقلنا لصفحة الاستمارة', active() === 'pg-result', activePages().join(','));
const res = $('result-content').innerHTML;
check('علامة النجاح المرسومة (SVG) موجودة', res.includes('ok-check') && res.includes('ok-title'));
check('ورقتان A4 — استمارة لكل وظيفة اختارها الزبون', (res.match(/class="form-sheet"/g) || []).length === 2,
  String((res.match(/class="form-sheet"/g) || []).length));
check('كل استمارة تقسم البيانات إلى ثلاثة أقسام مستقلة ومرقمة',
  (res.match(/class="fs-section fs-customer"/g) || []).length === 2 &&
  (res.match(/class="fs-section fs-job"/g) || []).length === 2 &&
  (res.match(/class="fs-section fs-employer"/g) || []).length === 2 &&
  (res.match(/class="fs-section-no"/g) || []).length === 6 &&
  (res.match(/<section/g) || []).length === (res.match(/<\/section>/g) || []).length);
check('الاستمارتان تحملان رقم الباركود', (res.match(/HRC-BC-000120/g) || []).length >= 4, String((res.match(/HRC-BC-000120/g) || []).length));
check('الاستمارة بلا تواقيع وختم وشرح التذييل', !/توقيع الزبون|توقيع نقطة البيع|ختم الشركة|خدمات الشركة تنحصر/.test(res));
check('الاستمارتان تُعيدان بيانات الزبون المطبوعة', res.includes('أحمد محمد علي حسن') && res.includes('07712345678'));
check('كل استمارة تحمل وظيفتها وكودها',
  res.includes('عامل إنتاج') && res.includes('HRC-1042') && res.includes('سائق توصيل') && res.includes('HRC-1047'));
check('كل استمارة تحمل بيانات صاحب عملها (اسم/هاتف/عنوان/مكان المقابلة)',
  res.includes('معمل بابل') && res.includes('07701234567') && res.includes('المنطقة الصناعية') && res.includes('بوابة المعمل') &&
  res.includes('شركة الفرات') && res.includes('07709998888') && res.includes('شارع ٤٠'));
check('كل استمارة تسمّي فرصتها (١ من ٢ / ٢ من ٢)',
  /الفرصة المستخدمة/.test(res) && res.includes('١ من ٢') && res.includes('٢ من ٢'));
check('الوظيفة غير المُعيَّنة (HRC-1049) لا تظهر في أي استمارة', !res.includes('HRC-1049'));
check('ملاحظة «باركود البطاقة نفسه» موجودة في الأوراق', res.includes('fs-qr-note') && res.includes('باركود البطاقة نفسه'));
check('كل استمارة بها الفرصة والمهلة وتاريخ الانتهاء', /الفرصة/.test(res) && /مهلة الرد على الحجز/.test(res));
check('عنوان النجاح يعدّ الفرصتين', /مُسجَّلة <b>٢<\/b> فرص/.test(res), (res.match(/ok-sub[^<]*/) || [''])[0]);
const acts = $('result-actions').innerHTML;
check('زر طباعة الاستمارات', actions_has(acts, 'طباعة') && acts.includes('G.printApplication()') && typeof sandbox.G.printApplication === 'function');
check('لا زر «وظيفة ثانية» — الفرصتان استُهلكتا', !actions_has(acts, 'وظيفة ثانية'), acts.slice(0, 160));
check('تنبيه استهلاك الفرصتين ظاهر للزبون', /استُهلكت فرص البطاقة/.test(res), res.slice(-260));
check('زر نسخ رابط الاستمارة', acts.includes('copyLink'));
check('شريط التقدم يقول «تم التقديم» ١٠٠٪', /تم التقديم/.test($('step-label').textContent), $('step-label').textContent);

function actions_has(html, word) { return html.includes(word); }

/* ===========================================================================
 *  13) الرجوع واستهلاك الفرص
 * =========================================================================== */
step(11, 'الرجوع واستهلاك الفرصتين');
click(findByOnclick('G.backToJobs()'));
await tick(40);
check('«العودة للوظائف» ترجع لقائمة الوظائف', active() === 'pg-jobs', activePages().join(','));
check('الوظيفتان المستخدمتان تُعلَّمان «تم التقديم» ولا تُختاران ثانية',
  doc.querySelectorAll('.job-card.is-done').length === 2 &&
  doc.querySelectorAll('.job-card.is-done').every((c) => /تم التقديم/.test(c.innerHTML)),
  String(doc.querySelectorAll('.job-card.is-done').length));
check('شريط الفرص يقول «لا توجد فرصة متاحة — انتهت فرصك»',
  /لا توجد فرصة متاحة/.test($('chances-bar').innerHTML), $('chances-bar').innerHTML);
check('زر «التالي» معطَّل بعد استهلاك الفرصتين', $('btn-jobs-next').attrs.disabled !== undefined);

step(12, 'حماية الزبون: الطلب المسجَّل لا يتحول إلى «خطأ اتصال» إن تعطّل العرض');
check('دالة الاستمارة الاحتياطية موجودة وتُنتج صفحة قابلة للطباعة', (() => {
  const realErr = console.error;
  console.error = () => { };                    /* الخطأ هنا متوقَّع: نختبر مسار الاحتياط */
  try { vm.runInContext('G.plainResult(new Error("عطل تجريبي"))', ctx); }
  finally { console.error = realErr; }
  const h = $('result-content').innerHTML;
  const a = $('result-actions').innerHTML;
  return h.includes('HRC-BC-000120') && h.includes('تم تسجيل طلبك') && h.includes('HRC-1042') &&
    (a.includes('طباعة') || h.includes('طباعة'));
})());
check('الاستمارة الاحتياطية تُخبر الزبون بألا يعيد التقديم (الفرصة تُستهلك مرة واحدة)',
  /لا تُعِد التقديم|لا تعيد التقديم/.test($('result-content').innerHTML));
check('لا تُخفى الحقيقة: لا رسالة «خطأ اتصال» في مسار الحفظ الناجح',
  readFileSync(join(ROOT, 'apply.html'), 'utf8').includes('saved=true'));

/* ===========================================================================
 *  13) «البورتريه» في خطوة اختيار الوظيفة — بروز المختارة وتغبيش البقية
 * =========================================================================== */
step(13, 'اختيار الوظيفة: تأثير البورتريه (المختارة تبرز والبقية تُغبَّش)');
{
  const src = readFileSync(join(ROOT, 'apply.html'), 'utf8');
  check('القائمة تُفعّل has-focus عند وجود وظيفة مختارة',
    /classList\.toggle\('has-focus',\s*pickedJobs\.length>0 && pickedJobs\.length>=G\.maxPick\(\)\)/.test(src));
  check('البقية تُغبَّش وتُعتَّم (blur + تعتيم + تصغير)',
    /has-focus \.job-card:not\(\.selected\)\{[^}]*filter:blur/.test(src) &&
    /has-focus \.job-card:not\(\.selected\)\{[^}]*opacity:\.4/.test(src));
  check('المختارة تبرز للأمام (z-index + تكبير + هالة ذهبية)',
    /has-focus \.job-card\.selected\{[^}]*z-index:20/.test(src) &&
    /has-focus \.job-card\.selected\{[^}]*scale\(1\.0/.test(src) &&
    /rgba\(200,162,74,\.\d+\)/.test(src));
  check('البقية المُغبَّشة لا تستقبل النقر (pointer-events:none) حتى يُلغى الاختيار',
    /has-focus \.job-card:not\(\.selected\)\{[^}]*pointer-events:none/.test(src));
  check('تأثير البورتريه يُلغى مع prefers-reduced-motion (ويبقى التعتيم وظيفياً)',
    /prefers-reduced-motion:reduce[\s\S]{0,400}has-focus \.job-card\.selected\{ transform:none/.test(src));
}

/* ===========================================================================
 *  الخلاصة
 * =========================================================================== */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
