#!/usr/bin/env node
// Real DOM + actual inline input/change/click handlers. Network is mocked, never production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../apply.html', import.meta.url), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
const make = (code, extra) => ({id:code,code,title:'موظف',category:'خدمات',region:'المركز',
  governorate:'بغداد',shift:'صباحي',gender:'لا فرق',salary_min:500000,salary_max:700000,
  requirements:[],description:'',status:'available',vacancies:2,created_at:'2026-10-01T00:00:00Z',...extra});
const fixtures = [
  make('F-100',{title:'عَامِل إنتاج',region:'الكرادة',requirements:['خبرة بالحاسوب'],gender:'ذكر'}),
  make('F-200',{governorate:'البصرة',region:'العشار',category:'مبيعات',gender:'أنثى',shift:'مسائي',salary_min:800000,created_at:'2026-10-03T00:00:00Z'}),
  make('F-300',{governorate:'بغداد',region:'المنصور',category:'مبيعات',gender:'كلا الجنسين',salary_min:600000,created_at:'2026-10-02T00:00:00Z'}),
  make('F-400',{governorate:'حلبجة',region:'مركز حلبجة',salary_min:400000}),
  make('F-500',{governorate:'اربيل',region:'عنكاوا',salary_min:700000}),
  make('F-600',{governorate:'',region:'غير محددة',salary_min:null,created_at:null}),
  make('F-700',{governorate:'الديوانية',category:'constructor',region:'__proto__'}),
  make('F-800',{governorate:'ذيقار',category:'مبيعات "خاصة" <img src=x onerror=alert(1)>',title:'<script>bad()</script>'})
];
const calls=[];
const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''), {
  url:'https://filters.example/apply.html?form=FILTER-TEST',runScripts:'dangerously',pretendToBeVisual:true
});
const w=dom.window, $=id=>w.document.getElementById(id);
w.HRCHttp={createClient:()=>({from:()=>({select:async()=>({data:fixtures,error:null})}),rpc:async(name,args)=>{
  calls.push({name,args});return {data:{ok:true,card:{serial:'FILTER-TEST',status:'blank',chancesLeft:2,profile:{},chances:[]}},error:null};
}})};
w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
let checks=0;
const check=(label, condition)=>{assert.ok(condition,label);console.log('  ✓ '+label);checks++;};
const codes=()=>Array.from(w.G.filteredJobs(),j=>j.code);
const set=(id,value,event='change')=>{const el=$(id);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));};
const reset=()=>w.G.resetJobFilters();
try {
  /* التقسيم الإداري العراقي صار ملفاً مستقلاً — يُحمَّل قبل السكربت كما في المتصفح */
  w.eval(readFileSync(new URL('../assets/js/iraq-admin.js',import.meta.url),'utf8'));
  w.eval(inline);
  await new Promise(resolve=>setTimeout(resolve,60));
  w.G.renderFilters();w.G.renderJobs();
  check('mock card read once; no submission',calls.length===1&&calls[0].name==='self_service_card');
  check('all jobs initially visible, including unknown governorate',codes().length===8);
  w.eval(readFileSync(new URL('../assets/js/config.js',import.meta.url),'utf8'));
  w.eval(readFileSync(new URL('../assets/js/store.js',import.meta.url),'utf8'));
  w.HRCStore.init({cloud:false});
  w.HRCStore.db().jobs=fixtures.map(j=>({...j,createdAt:j.created_at})).concat([{code:'RESERVED',status:'reserved',createdAt:'2026-10-20'},{code:'CLOSED',status:'closed',createdAt:'2026-10-21'}]);
  const siteCodes=Array.from(w.HRCStore.listJobs({status:'available'}),j=>j.code);
  check('default order matches actual main-section Store.listJobs for available jobs',codes().join(',')===siteCodes.join(',')&&$('jf-sort').value==='site');
  const publicDOM=new JSDOM(readFileSync(new URL('../src/partials/public.html',import.meta.url),'utf8'));
  const mainFields=Array.from(publicDOM.window.document.querySelectorAll('.filters input,.filters select'),el=>el.id.replace('filter-','').replace('governorate','province').replace(/^q$/,'query'));
  const cardFields=Array.from(w.document.querySelectorAll('.jf-primary input,.jf-primary select'),el=>el.id.replace('jf-',''));
  check('primary filter order exactly matches the main jobs section',cardFields.join(',')===mainFields.join(','));
  publicDOM.window.close();
  check('only available status can be shown for card submission',$('jf-status').disabled&&$('jf-status').options.length===1&&$('jf-status').value==='available');
  check('all five profile steps use full-width intro and fields panels',w.document.querySelectorAll('.profile-page .profile-card .step-intro').length===5&&w.document.querySelectorAll('.profile-page .profile-card .step-fields').length===5);
  check('viewport permits user zoom instead of restricting accessibility',!w.document.querySelector('meta[name=viewport]').content.includes('maximum-scale'));

  check('all 19 Iraqi governorates plus all-option', $('jf-province').options.length===20);
  check('governorate list matches config exactly (no duplicates, Qadisiyah included)',
    (()=> {
      const list = [...$('jf-province').options].map(o=>o.value).filter(Boolean);
      const cfg = w.HRC_CONFIG.governorates;
      return list.length===19 && list.length===new Set(list).size &&
        cfg.every(g=>list.includes(g)) && list.includes('القادسية') && list.includes('حلبجة');
    })(),
    JSON.stringify([...$('jf-province').options].map(o=>o.value)));
  check('aliases normalized in mapped jobs', w.G.filteredJobs().find(j=>j.code==='F-500').governorate==='أربيل');
  check('prototype-like categories remain available (no region filter anymore)',
    Array.from($('jf-category').options).some(o=>o.value==='constructor') && !$('jf-region'));
  check('no region filter anywhere in the applicant filters (2026-10-24)',
    !w.document.getElementById('jf-region') && !/المنطقة<\/label>/.test(w.document.querySelector('.jf-primary').innerHTML));
  check('untrusted labels never become markup',!w.document.querySelector('#jf-category img')&&!w.document.querySelector('#jobs-list script'));
  set('jf-province','بغداد');
  check('province filters exactly',codes().join(',')==='F-300,F-100');
  set('jf-province','البصرة');check('province filters exactly (replaces region filter)',codes().join(',')==='F-200');
  set('jf-province','');
  set('jf-category','مبيعات');set('jf-shift','مسائي');set('jf-gender','أنثى');set('jf-salary','۸۰۰٬۰۰۰','input');
  check('category + shift + gender + Persian formatted salary intersect',codes().join(',')==='F-200');
  set('jf-salary','٨٠٠،٠٠١','input');check('salary uses advertised starting pay, not upper bound',codes().length===0);
  check('no-result message shown',$('jobs-empty').style.display==='block');
  reset();set('jf-query','عامل انتاج حاسوب','input');check('multi-term Arabic search ignores diacritics and alef variants',codes().join(',')==='F-100');
  set('jf-query','f-١٠٠','input');check('case-insensitive code search normalizes Arabic digits',codes().join(',')==='F-100');
  reset();set('jf-gender','أنثى');check('gender includes unrestricted ads but excludes male-only',!codes().includes('F-100')&&codes().includes('F-200')&&codes().includes('F-300'));
  set('jf-gender','لا فرق');check('unrestricted-only handles both gender labels',!codes().includes('F-200')&&codes().includes('F-300')&&codes().includes('F-400'));
  reset();set('jf-salary','-1','input');check('invalid salary has accessible error and no misleading matches',!$('jf-error').hidden&&codes().length===0);
  set('jf-salary','٥٠٠٬٠٠٠','input');check('valid Arabic salary clears error', $('jf-error').hidden&&codes().length===6);
  reset();set('jf-sort','salary-desc');check('descending salary and unknown salaries last',codes()[0]==='F-200'&&codes().at(-1)==='F-600');
  set('jf-sort','salary-asc');check('ascending salary still puts unknown last',codes()[0]==='F-400'&&codes().at(-1)==='F-600');
  set('jf-sort','newest');check('newest sorting uses public created_at',codes().slice(0,3).join(',')==='F-200,F-300,F-100');
  reset();$('f-prov').value='البصرة';w.G.pickGender(w.document.querySelector('.gender-opt[data-v="أنثى"]'));set('jf-sort','recommended');
  check('recommendation prioritizes profile province without hiding other jobs',codes()[0]==='F-200'&&codes().length===8);
  set('jf-query','no matches','input');set('jf-picked',true);w.G.useMyJobFilters();
  check('explicit profile preset clears conflicting filters and uses profile',codes().join(',')==='F-200'&&$('jf-query').value===''&&!$('jf-picked').checked&&$('jf-gender').value==='أنثى');
  reset();w.G.pickJob('F-100');w.G.pickJob('F-200');
  check('two selections are enabled before filtering',!$('btn-jobs-next').disabled);
  set('jf-province','حلبجة');check('hidden selections remain in footer with remove controls',$('jobs-hint').textContent.includes('F-100')&&$('jobs-hint').textContent.includes('F-200')&&$('jobs-hint').querySelectorAll('.job-remove').length===2&&!$('btn-jobs-next').disabled);
  reset();set('jf-picked',true);check('selected-only uses existing picks',codes().sort().join(',')==='F-100,F-200');
  $('jobs-hint').querySelector('.job-remove').click();check('hidden/visible pick can be removed independently',codes().join(',')==='F-200');
  reset();check('reset restores site order but preserves remaining selection',codes().join(',')===siteCodes.join(',')&&$('jobs-hint').textContent.includes('F-200'));
  check('requested result count is removed', !$('jobs-count'));
  check('all filter controls have associated visible labels',Array.from(w.document.querySelectorAll('.job-filters input,.job-filters select')).every(el=>el.closest('label')||w.document.querySelector('label[for="'+el.id+'"]')));
  check('filtering and selection never call a write RPC or spend chances',calls.length===1);
  w.G.setJobFilter('province','الديوانية');
  check('governorate alias works through public filter API',codes().join(',')==='F-700'&&$('jf-province').value==='القادسية');
  w.G.setJobFilter('province','constructor');
  check('prototype-like governorate input is handled without error',codes().length===0);
  $('jobs-empty').querySelector('button').click();
  check('empty-state reset button restores results without spending a chance',codes().length===8&&calls.length===1);
  check('profile labels are programmatically associated with their fields',Array.from(w.document.querySelectorAll('.step-fields input,.step-fields select')).every(el=>w.document.querySelector('label[for="'+el.id+'"]')));
  // Apply the actual print rules to the DOM as a separate stylesheet: hidden UI
  // must not reserve space and produce an extra blank sheet after the forms.
  const printStyle=w.document.createElement('style');
  printStyle.textContent=Array.from(w.document.styleSheets).flatMap(sheet=>Array.from(sheet.cssRules)).filter(rule=>rule.media?.mediaText==='print').flatMap(rule=>Array.from(rule.cssRules,child=>child.cssText)).join('\n');
  w.document.head.appendChild(printStyle);
  check('print removes result actions and the separate back-navigation row',w.getComputedStyle($('result-actions')).display==='none'&&w.getComputedStyle(w.document.querySelector('#pg-result > .btn-row')).display==='none');
  check('A4 pages use breaks before subsequent forms, not a trailing blank page',printStyle.textContent.includes('.form-sheet + .form-sheet')&&printStyle.textContent.includes('break-before: page'));

  /* ── فلتر مضغوط (2026-10-24) ── */
  reset();
  check('compact filter is one bar with only the four primary controls',
    !!w.document.querySelector('.job-filters.jf-compact .jf-bar.jf-primary') &&
    w.document.querySelectorAll('.jf-bar input, .jf-bar select').length === 4 &&
    w.document.querySelector('.jf-bar #jf-query') && w.document.querySelector('.jf-bar #jf-province'));
  check('advanced filters live in a collapsed panel, not the main bar',
    w.document.getElementById('jf-advanced').hidden === true &&
    !w.document.getElementById('jf-advanced').classList.contains('jf-primary') &&
    w.document.getElementById('jf-advanced').contains(w.document.getElementById('jf-category')));
  check('«فلاتر» button opens the panel and syncs aria-expanded',
    (() => {
      const btn = w.document.getElementById('jf-more');
      btn.click();
      const opened = w.document.getElementById('jf-advanced').hidden === false && btn.getAttribute('aria-expanded') === 'true';
      btn.click();
      const closed = w.document.getElementById('jf-advanced').hidden === true && btn.getAttribute('aria-expanded') === 'false';
      return opened && closed;
    })());
  check('filter badge counts active filters and hides when none',
    (() => {
      const badge = w.document.getElementById('jf-badge');
      if (!badge.hidden) return false;
      set('jf-shift', 'مسائي'); set('jf-gender', 'أنثى');
      return badge.hidden === false && badge.textContent.trim() === '٢' &&
        w.document.getElementById('jf-more').classList.contains('has-filters');
    })());
  check('result count stays absent when filters change', !$('jobs-count'));
  /* ── صورة الوظيفة داخل البطاقة ── */
  check('active filters render as removable chips (not raw values scattered in fields)',
    (() => {
      reset();
      set('jf-shift', 'مسائي');
      const chips = [...w.document.querySelectorAll('#jf-chips .jf-chip')];
      if (chips.length !== 1) return false;
      if (!/مسائي/.test(chips[0].textContent)) return false;
      chips[0].click();
      const after = w.document.querySelectorAll('#jf-chips .jf-chip').length;
      return after === 0 && $('jf-shift').value === '' && w.document.getElementById('jf-chips').hidden === true;
    })());
  check('job card is structured: state badge + 4 meta cells + pay row + actions',
    (() => {
      reset();
      const card = w.document.querySelector('#jobs-list .job-card');
      if (!card) return false;
      const state = card.querySelector('.job-state');
      const meta = card.querySelectorAll('.job-meta .jm');
      const pay = card.querySelector('.job-pay .job-pay-v');
      const acts = card.querySelectorAll('.job-actions .btn');
      return !!state && meta.length === 4 && !!pay && acts.length >= 2 &&
        card.querySelectorAll('.jm .jm-ic').length === 4;
    })());
  check('job images are shown whole (object-fit: contain) everywhere',
    (() => {
      const css = Array.from(w.document.styleSheets)
        .flatMap((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText); } catch (e) { return []; } }).join('\n');
      const applySrc = w.document.documentElement.outerHTML;
      const cover = /\.job-thumb img\{[^}]*object-fit:\s*cover/.test(css) ||
        /\.job-image img\{[^}]*object-fit:\s*cover/.test(css);
      if (cover) return 'ما زال هناك قصّ (cover) لصور الوظائف';
      const containThumb = /\.job-thumb img\{[^}]*object-fit:\s*contain/.test(css) ||
        /object-fit:contain/.test(applySrc);
      return containThumb || 'مصغّرة الوظيفة ليست contain';
    })());  check('job cards render a thumbnail only when the job has an image',
    (() => {
      /* الوظائف المعروضة في الصفحة (وليست مخزن المتصفح) */
      const list = w.G.currentJobs();
      list.forEach((j, i) => { j.imageUrl = i === 0 ? 'assets/img/jobs/job-truck.webp' : ''; });
      w.G.renderJobs();
      const cards = [...w.document.querySelectorAll('#jobs-list .job-card')];
      const withThumb = cards.filter((c) => c.querySelector('.job-thumb img'));
      const first = withThumb.length ? withThumb[0].querySelector('.job-thumb img') : null;
      /* صفحة التقديم تعرض مصغّرة صورة الشركة فقط عند وجود صورة للوظيفة */
      return withThumb.length === 1 && !!first &&
        /job-truck\.webp$/.test(first.getAttribute('src')) &&
        first.getAttribute('loading') === 'lazy';
    })());
  console.log(`\nJob filters: ${checks} checks passed.`);
} finally {dom.window.close();}
