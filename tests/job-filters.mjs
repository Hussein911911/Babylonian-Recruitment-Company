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
  check('aliases normalized in mapped jobs', w.G.filteredJobs().find(j=>j.code==='F-500').governorate==='أربيل');
  check('prototype-like categories and regions remain available',Array.from($('jf-category').options).some(o=>o.value==='constructor')&&Array.from($('jf-region').options).some(o=>o.value==='__proto__'));
  check('untrusted labels never become markup',!w.document.querySelector('#jf-category img')&&!w.document.querySelector('#jobs-list script'));
  set('jf-province','بغداد');
  check('province filters exactly',codes().join(',')==='F-300,F-100');
  check('region list depends on province',Array.from($('jf-region').options,o=>o.value).sort().join(',')===',الكرادة,المنصور');
  set('jf-region','الكرادة');check('province and region intersect',codes().join(',')==='F-100');
  set('jf-province','البصرة');check('changing province resets stale region',$('jf-region').value===''&&codes().join(',')==='F-200');
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
  check('result count announces total and selection', $('jobs-count').getAttribute('aria-live')==='polite'&&$('jobs-count').textContent.includes('٨')&&$('jobs-count').textContent.includes('١'));
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
  console.log(`\nJob filters: ${checks} checks passed.`);
} finally {dom.window.close();}
