// Actual card renderer: both QRs preserve their distinct destinations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const dom=new JSDOM('<html><head></head><body></body></html>',{runScripts:'outside-only'}),w=dom.window;
w.eval(read('assets/js/config.js'));w.eval(read('assets/js/qr.js'));
const encoded=[];const encode=w.HRCQR.encode;w.HRCQR.encode=function(text,...args){encoded.push(text);return encode.call(this,text,...args)};
w.HRCUI={esc:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
w.HRCStore={cardUrl:s=>'https://example.test/apply.html?form='+encodeURIComponent(s),fmtDate:()=>'',getAttempts:()=>[]};w.eval(read('assets/js/voucher.js'));
for (const n of [1,2,9,90]){
 const html=w.HRCVoucher.buildHtml({serial:'A1B2C3D4E5',status:'blank',cardNumber:n},[]);
 const fragment=JSDOM.fragment(html),front=fragment.querySelector('[aria-label="الوجه الأمامي لبطاقة التوظيف"]'),back=fragment.querySelector('[aria-label="الوجه الخلفي لبطاقة التوظيف"]');
 assert.equal(front.querySelector('.mk-brand-label').textContent,'منصة');
 assert.equal(front.querySelector('.mk-hole'),null,'no badge slot on front');
 assert.equal(back.querySelector('.mb-hole'),null,'no badge slot on back');
 assert.ok(front.querySelector('.mk-serial').textContent.includes('كود البطاقة'));
 assert.equal(front.querySelector('.mk-card-number b').textContent,String(n));
 assert.ok(!front.textContent.includes('الموقع الإلكتروني'));
 assert.ok(front.querySelector('.mk-qr svg') && back.querySelector('.mb-site-qr svg'));
 assert.equal(back.querySelector('.mb-art g'),null,'no artwork silhouettes behind the website QR');
 assert.deepEqual(encoded.splice(0),['https://example.test/apply.html?form=A1B2C3D4E5','https://babylonian-recruitment-company.pages.dev/']);
}
const old=JSDOM.fragment(w.HRCVoucher.buildHtml({serial:'OLD',status:'blank'},[]));
assert.equal(old.querySelector('.mk-card-number'),null,'old cards must not display an invented number');
dom.window.close();console.log('PASS card labels, conditional sequence and distinct front/back QR payloads.');
