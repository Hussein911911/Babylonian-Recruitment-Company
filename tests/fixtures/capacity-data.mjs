// Synthetic capacity fixtures only. Never injected into production config.
export function dataset(cards,jobs=Math.min(cards,1000)) {
 return {jobs:Array.from({length:jobs},(_,i)=>({id:'job-'+i,code:'HRC-'+(1042+i),title:'وظيفة تجريبية '+i,status:'available',employer_name:'جهة تجريبية',requirements:['خبرة مناسبة'],created_at:'2026-10-19T00:00:00Z'})),
 applicants:Array.from({length:cards},(_,i)=>({id:'app-'+i,serial:'HRC-BC-'+String(i).padStart(6,'0'),full_name:'زبون اختبار تحميل '+i,phone:'07700000000',address:'عنوان اصطناعي',status:'active',issue_date:'2026-10-19T00:00:00Z',expiry_date:'2026-11-19T00:00:00Z',attempt_limit:2,fee_amount:10000})),
 job_attempts:Array.from({length:cards*2},(_,i)=>({id:'attempt-'+String(i).padStart(8,'0'),serial:'HRC-BC-'+String(Math.floor(i/2)).padStart(6,'0'),attempt_no:i%2+1,slot_status:'empty',chance_code:'fixture-'+i})),
 audit_log:[],settings:[{key:'rules',value:{attempt_limit:2,validity_days:30,hold_hours:24}}],staff:Array.from({length:3},(_,i)=>({id:'staff-'+i,username:'staff'+i,full_name:'موظف تجريبي '+i,role:i?'staff':'admin',active:true}))};
}
