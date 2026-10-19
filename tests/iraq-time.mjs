// Same instants/filters in four HOST zones; no production services or data.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
if(!process.argv.includes('--child')){
 let total=0;
 for(const TZ of ['UTC','Asia/Baghdad','America/Los_Angeles','Asia/Tokyo']){
  const n=JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--child'],{env:{...process.env,TZ},encoding:'utf8'}));total+=n;
  console.log('✓ Baghdad time/date/filter checks in host zone '+TZ+': '+n);
 }
 for(const weight of [400,500,600,700])assert.equal(readFileSync(new URL('../assets/fonts/plex'+weight+'.woff2',import.meta.url)).subarray(0,4).toString(),'wOF2');
 assert.match(read('assets/fonts/IBM-Plex-Arabic-LICENSE.txt'),/SIL OPEN FONT LICENSE/);
 assert.match(read('assets/css/style.css'),/font-family: 'IBM Plex Sans Arabic', 'Cairo'/);
 assert.match(read('assets/js/voucher.js'),/font-family:Cairo/);
 assert.match(read('assets/js/voucher.js'),/document.fonts.load/);
 console.log(`PASS ${total+8} Iraq time/font checks; UTC storage unchanged.`);
}else{
 let n=0;const check=(a,b)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),b);n++;};
 const storage=()=>({getItem:()=>null,setItem(){},removeItem(){}});
 const ctx=vm.createContext({localStorage:storage(),sessionStorage:storage(),setInterval:()=>0,clearInterval(){},setTimeout:()=>0,console:{warn(){},log(){}}});
 vm.runInContext(read('assets/js/config.js'),ctx);vm.runInContext(read('assets/js/store.js'),ctx);
 const s=ctx.HRCStore;s.init();
 check(s.timeZone,'Asia/Baghdad');
 check(s.fmtDateTime('2026-10-19T22:15:30Z'),'2026-10-20 01:15:30');
 check(s.fmtDateTime('2026-10-20T01:15:30+03:00'),'2026-10-20 01:15:30');
 check(s.fmtDateTime('2026-10-19T12:00:00-07:00'),'2026-10-19 22:00:00');
 check(s.fmtDateTime('2026-10-19 22:00:00'),'2026-10-19 22:00:00');
 check(s.fmtDateTime('2026-10-19T22:00:00'),'2026-10-19 22:00:00');
 check(s.fmtDateTime('2026-12-31T21:00:00Z'),'2027-01-01 00:00:00');
 check(s.fmtDate('2026-10-19T20:59:59.999Z'),'2026-10-19');
 check(s.fmtDate('2026-10-19T21:00:00Z'),'2026-10-20');
 check(s.fmtDate('1990-06-15'),'1990-06-15');
 check(s.fmtDate('2024-02-29'),'2024-02-29');
 check(s.fmtDate('2026-02-29'),'—');
 check(s.fmtDateTime('invalid'),'—');check(s.fmtDate('invalid'),'—');
 check(s.dayOffset(-1,'2026-12-31T21:15:00Z'),'2026-12-31');
 check(s.dayOffset(1,'2026-12-31T21:15:00Z'),'2027-01-02');
 const instant=new Date('2026-10-19T22:00:00Z'),original=instant.getTime();s.fmtDateTime(instant);check(instant.getTime(),original);
 check(s.diffHours('2026-11-02T05:30:00Z','2026-11-01T05:30:00Z'),24);
 const stamps=['2026-10-19T20:59:59.999Z','2026-10-19T21:00:00Z','2026-10-20T20:59:59.999Z','2026-10-20T21:00:00Z'];
 s.db().audit=stamps.map((ts,i)=>({id:i+1,ts,action:'fixture',user:'fixture'}));
 s.db().applicants=stamps.map((issueDate,i)=>({serial:'fixture-'+i,issueDate,fee:1000,feePaid:true}));
 s.db().applicants.push({serial:'unissued',issueDate:null,fee:1000,feePaid:true});
 const before=JSON.stringify(s.db());
 check(s.listAudit({from:'2026-10-20',to:'2026-10-20'}).map(x=>x.id),[3,2]);
 check(s.listAudit({from:'2026-10-20'}).map(x=>x.id),[4,3,2]);
 check(s.listAudit({from:'2026-99-99'}),[]);
 check(s.listAudit({from:'2026-10-21',to:'2026-10-20'}),[]);
 check(s.financialTotals('2026-10-20','2026-10-20').forms,2);
 check(s.financialTotals('2026-10-20','2026-10-20').expected,2000);
 check(s.financialTotals('2026-10-19','2026-10-19').forms,1);
 check(s.financialTotals('2026-10-21','2026-10-21').forms,1);
 check(s.financialTotals().forms,5);
 check(JSON.stringify(s.db()),before);
 process.stdout.write(JSON.stringify(n));
}
