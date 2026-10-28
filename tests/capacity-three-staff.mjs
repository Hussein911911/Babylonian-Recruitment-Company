// Real cloud mapper/loader, synthetic capped PostgREST. No production requests.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const source=readFileSync(process.env.HRC_CAPACITY_SOURCE||new URL('../assets/js/cloud.js',import.meta.url),'utf8');
const ctx=vm.createContext({console,Date,setTimeout,clearTimeout});vm.runInContext(source,ctx);const C=ctx.HRCCloud;
import {dataset} from './fixtures/capacity-data.mjs';

function client(data,{cap=1000,failPage=false,countOverride=null,changeCount=false}={}) {
 const metrics={requests:0,bytes:0};
 return {metrics,from(table){let from=0,to=Infinity,limit=Infinity,orders=[];
 const q={select(){return q;},order(key,opts){orders.push([key,opts]);return q;},limit(n){limit=n;return q;},range(a,b){from=a;to=b;return q;},then(ok,no){
  metrics.requests++;
  if(failPage&&table==='job_attempts'&&from>0)return Promise.resolve({error:{message:'synthetic second-page outage'},data:null}).then(ok,no);
  const sorted=[...data[table]];for(const [key,o] of orders.toReversed())sorted.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(o?.ascending===false?-1:1));
  const rows=sorted.slice(from,from+Math.min(cap,to-from+1,limit));metrics.bytes+=Buffer.byteLength(JSON.stringify(rows));
  return Promise.resolve({data:rows,count:(table==='applicants'&&countOverride!==null)?countOverride:(data[table].length+(changeCount&&from>0?1:0)),error:null}).then(ok,no);
 }};return q;}};
}
const results=[];
for(const cards of [400,500,1000,3000,10000]) {
 const data=dataset(cards),start=performance.now();
 const workers=await Promise.all(Array.from({length:3},async()=>{const c=client(data),t=performance.now(),db=await C.fetchAll(c);return {cards:db.applicants.length,chances:db.attempts.length,jobs:db.jobs.length,failed:db.meta.failedTables,ms:Math.round(performance.now()-t),jsonBytes:Buffer.byteLength(JSON.stringify(db)),requests:c.metrics.requests,downloadBytes:c.metrics.bytes};}));
 const complete=workers.every(w=>w.cards===cards&&w.chances===cards*2&&w.jobs===data.jobs.length&&!w.failed.length);
 results.push({cards,jobs:data.jobs.length,expectedChances:cards*2,complete,threeStaffElapsedMs:Math.round(performance.now()-start),workers});
 if(!process.env.HRC_CAPACITY_OBSERVE)assert.ok(complete,'All three employees must receive complete data at '+cards+' cards');
}
if(!process.env.HRC_CAPACITY_OBSERVE){
 const partial=await C.fetchAll(client(dataset(1000),{failPage:true}));assert.ok(partial.meta.failedTables.includes('job_attempts'));assert.equal(partial.attempts.length,0,'Never adopt a partial attempt table');
 const smallCap=await C.fetchAll(client(dataset(1000),{cap:100}));assert.equal(smallCap.attempts.length,2000,'Even an API cap below requested page size must not truncate');
 const oversize=await C.fetchAll(client(dataset(400),{countOverride:100001}));assert.ok(oversize.meta.failedTables.includes('applicants'));assert.equal(oversize.applicants.length,0);
 const changing=await C.fetchAll(client(dataset(1000),{changeCount:true}));assert.ok(changing.meta.failedTables.includes('job_attempts'));
 const duplicates=dataset(1000);duplicates.job_attempts[600].id=duplicates.job_attempts[0].id;
 const duplicateResult=await C.fetchAll(client(duplicates));assert.ok(duplicateResult.meta.failedTables.includes('job_attempts'));assert.equal(duplicateResult.attempts.length,0);

}
// Exercise the SHIPPED lightweight HTTP adapter, including count headers and
// offsets, against a synthetic public API capped below our requested page size.
if(!process.env.HRC_CAPACITY_OBSERVE){
 const rows=dataset(1000).jobs,requests=[];
 const httpContext=vm.createContext({console,fetch:async(url,init)=>{
  const u=new URL(url),offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||1000);
  requests.push({offset,prefer:init.headers.Prefer});assert.ok(u.pathname.endsWith('/public_jobs'));
  const page=rows.slice(offset,offset+Math.min(100,limit));
  return new Response(JSON.stringify(page),{headers:{'content-range':offset+'-'+(offset+page.length-1)+'/'+rows.length}});
 }});
 vm.runInContext(readFileSync(new URL('../assets/js/cloud-http.js',import.meta.url),'utf8'),httpContext);
 const publicResult=await C.fetchPublicJobs(httpContext.HRCHttp.createClient('https://synthetic.invalid','public-fixture'));
 assert.ok(publicResult.ok);assert.equal(publicResult.jobs.length,1000);assert.equal(requests.length,10);
 /* 2026-10-24: القراءة العامة لم تعد تطلب count=exact — العدّ على public_jobs
    يُنفّذ استعلامه الفرعي المترابط لكل صف، وهو أثقل ما يواجهه كل زائر. */
 assert.ok(requests.every(r=>!r.prefer),'public reads must not request exact counts: '+JSON.stringify(requests.map(r=>r.prefer)));
 assert.equal(requests.at(-1).offset,900);
}
mkdirSync(new URL('./.tmp/capacity/',import.meta.url),{recursive:true});
writeFileSync(new URL('./.tmp/capacity/'+(process.env.HRC_CAPACITY_OBSERVE?'before':'after')+'.json',import.meta.url),JSON.stringify(results,null,2));
console.table(results.map(r=>({cards:r.cards,jobs:r.jobs,chances:r.expectedChances,complete:r.complete,threeStaffMs:r.threeStaffElapsedMs,perStaffMiB:(r.workers[0].jsonBytes/1048576).toFixed(2),perStaffRequests:r.workers[0].requests})));
console.log('Synthetic capped API only. Timings exclude real network, database SQL and real multi-device conflicts.');
