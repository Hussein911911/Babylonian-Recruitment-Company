// Company hours must agree across built pages and persisted settings.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const hours='يومياً من 8:00 صباحاً حتى 10:00 مساءً';
const description='فريقنا متواجد طيلة أيام الأسبوع لمتابعة الطلبات والإجابة على استفساراتكم.';
for(const path of ['index.html','verify.html','dashboard.html','404.html','hrc-standalone.html','hrc-light.html']){
  const html=read(path);
  assert.ok(html.includes(hours),path+' header');
  assert.doesNotMatch(html,/الجمعة: عطلة رسمية|يومياً: 9:00 صباحاً – 10:00 مساءً|9:00 صباحاً – 5:00 مساءً/,path+' outdated hours');
}
for(const path of ['index.html','hrc-standalone.html','hrc-light.html']){
  const html=read(path);
  assert.ok(html.includes(`<p>${hours}</p>`) && html.includes(`<p>${description}</p>`),path+' contact');
}
const config=read('assets/js/config.js');assert.ok(config.includes(`hours: '${hours}'`));assert.ok(config.includes("holiday: 'طوال أيام الأسبوع'"));
const db=new PGlite();try{
 await db.exec(`create schema brc;create table brc.settings(key text primary key,value jsonb);insert into brc.settings values ('company','{"hours":"old","holiday":"old","name":"unchanged"}'::jsonb),('rules','{"attempt_limit":3}'::jsonb);`);
 await db.exec(read('supabase/migrations/20261101180000_update_daily_opening_to_eight.sql'));
 await db.exec(read('supabase/migrations/20261101180000_update_daily_opening_to_eight.sql'));
 const result=await db.query('select key,value from brc.settings order by key');
 assert.deepEqual(result.rows[0].value,{hours,holiday:'old',name:'unchanged'});
 assert.deepEqual(result.rows[1].value,{attempt_limit:3});
}finally{await db.close();}
console.log('PASS company hours across built pages, configuration, and database migration.');
