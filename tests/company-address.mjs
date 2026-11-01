import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const message='لا تحُدّنا جغرافيا.. متواجدون حيثما وُجدت الفرصة وطموح السعي.';
for(const path of ['index.html','verify.html','dashboard.html','404.html','hrc-standalone.html','hrc-light.html']){
  const doc=new JSDOM(read(path)).window.document;
  assert.ok(doc.querySelector('.hc-address').textContent.includes(message),path+' header');
  assert.ok(doc.querySelector('footer').textContent.includes(message),path+' footer');
  assert.equal(doc.querySelector('.hc-address').tagName,'SPAN');
  assert.equal(doc.querySelector('a[href*="google.com/maps"]'),null,path+' no location link');
  assert.ok(!doc.body.textContent.includes('حلة - شارع 60 - قرب مدينة حمورابي'),path+' no old office address');
  if(doc.querySelector('#contact')) assert.ok(doc.querySelector('#contact').textContent.includes(message),path+' contact');
}
const db=new PGlite();try{
 await db.exec(`create schema brc;create table brc.settings(key text primary key,value jsonb);insert into brc.settings values ('company','{"address":"old","addressShort":"old","hours":"unchanged"}'::jsonb),('rules','{"attempt_limit":3}'::jsonb);`);
 await db.exec(read('supabase/migrations/20261101160000_company_address_message.sql'));
 const result=await db.query('select key,value from brc.settings order by key');
 assert.deepEqual(result.rows[0].value,{address:message,addressShort:message,hours:'unchanged'});
 assert.deepEqual(result.rows[1].value,{attempt_limit:3});
}finally{await db.close();}
console.log('PASS updated company text on all pages, no map links, other settings unchanged.');
