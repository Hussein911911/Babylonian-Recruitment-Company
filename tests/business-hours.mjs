// Company hours must agree across every built page and persisted settings.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
for(const path of ['index.html','verify.html','dashboard.html','404.html','hrc-standalone.html','hrc-light.html']){
  const html=read(path);
  assert.match(html,/يومياً: 9:00 صباحاً – 10:00 مساءً/,path+' header');
  assert.doesNotMatch(html,/الجمعة: عطلة رسمية|السبت – الخميس: 9:00|9:00 صباحاً – 5:00 مساءً/,path+' outdated hours');
}
for(const path of ['index.html','hrc-standalone.html','hrc-light.html']){
  const html=read(path);
  assert.match(html,/<span>طوال أيام الأسبوع<\/span><span>9:00 صباحاً – 10:00 مساءً<\/span>/,path+' contact');
}
const config=read('assets/js/config.js');assert.match(config,/hours: 'يومياً: 9:00 صباحاً – 10:00 مساءً'/);assert.match(config,/holiday: 'طوال أيام الأسبوع'/);
const db=new PGlite();try{
 await db.exec(`create schema brc;create table brc.settings(key text primary key,value jsonb);insert into brc.settings values ('company','{"hours":"old","holiday":"old","name":"unchanged"}'::jsonb),('rules','{"attempt_limit":3}'::jsonb);`);
 await db.exec(read('supabase/migrations/20261101020000_company_opening_hours.sql'));
 const result=await db.query('select key,value from brc.settings order by key');
 assert.deepEqual(result.rows[0].value,{hours:'يومياً: 9:00 صباحاً – 10:00 مساءً',holiday:'طوال أيام الأسبوع',name:'unchanged'});
 assert.deepEqual(result.rows[1].value,{attempt_limit:3});
}finally{await db.close();}
console.log('PASS company hours across built pages, configuration, and database migration.');
