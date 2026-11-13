#!/usr/bin/env node
/* ===========================================================================
 *  HRC — أداة مراقبة سياسات الأمان (Security Policy Monitor)
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا أداة منفصلة عن الاختبارات؟
 *
 *  الاختبار يجيب سؤالاً واحداً: «هل الكود الحالي مطابق للسياسة؟» ويفشل بصمت
 *  عند أول خطأ. أما المراقبة فتجيب: «ما تغيّر؟ وهل الدولة الحالية للقاعدة
 *  الحيّة مطابقة للملف المرجعي (baseline)؟» — وهي أسئلة تُسأل يومياً لا مرة.
 *
 *  ثلاث قدرات:
 *    1. --capture        : يلتقط بصمة سياسة الأمان من ملف المخطط إلى baseline.
 *    2. --compare        : يقارن بصمة اليوم بالـ baseline ويشرح كل انحراف.
 *    3. --verify <json>  : يتحقق من **قاعدة Supabase الحيّة** (تُمرَّر بصمتها).
 *
 *  البصمة ليست «عدداً»: كل دالة تحمل حالة صريحة لكل دور، فأي دالة تُضاف أو
 *  تُعاد منحها لـ PUBLIC تظهر كسطر انحراف مسمّى — لا كرقم تغيّر.
 *
 *  التشغيل:
 *    node tools/security-monitor.mjs --capture
 *    node tools/security-monitor.mjs --compare
 *    node tools/security-monitor.mjs --verify live.json
 *  لا يحتاج شبكة ولا أسراراً في الوضعين الأولين.
 * =========================================================================== */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'docs', 'security-baseline.json');
const SCHEMA = join(ROOT, 'docs', 'schema.sql');

const read = (p) => readFileSync(p, 'utf8');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
};

/* ── السياسة المرجعية: ما يجب أن يكون، مكتوباً صراحةً ─────────────────────
   هذه هي «الحقيقة» التي تُقارن بها البصمة. أي دالة ليست هنا ولا هناك = منح
   غير مبرَّر، وأي دالة هنا وليست في القاعدة = مسار مكسور. */
export const POLICY = {
  /* مسارات الزبون العامة — تعمل بلا جلسة (apply.html + «بطاقتي») */
  anon: [
    'lookup_card(text,text)',
    'use_chance(text,text,text)',
    'verify_card_code(text,text)',
    'self_service_card(text,text)',
    'apply_with_card(text,text,jsonb)',
    'customer_application_details(text,integer)'
  ],
  /* أدوات الموظف — تحتاج جلسة مصادَقة + سياسات RLS */
  authenticated: [
    'is_staff()', 'is_admin()', 'current_staff_id()',
    'next_job_code()', 'next_form_serial()', 'ensure_card_attempts(text)',
    'run_auto_release()', 'verify_form(text,text)',
    'request_form(text,text,text,date,text,text,text)',
    'select_attempt(text,text)', 'set_outcome(text,smallint,text,text)',
    'release_hold(text,smallint,text)',
    'office_submit(uuid,text,jsonb,jsonb)',
    'staff_card_history(text,integer)', 'staff_card_report(date,date)',
    'staff_issuance_registry(text)',
    'recovery_manage(text,uuid,text,text)', 'recovery_schedule_get()',
    'recovery_schedule_set(int[],text)'
  ],
  /* دوال ممنوعة على العميل نهائياً (واجهة داخلية أو مولّد أسرار) */
  never_client: [
    'activate_card(text,jsonb)', 'card_gate(text,text,text,boolean)',
    'chance_code()', 'new_card_print_code()', 'normalize_card_code(text)',
    'verify_token(text)',
    'apply_with_card_original(text,text,jsonb)', 'self_service_card_original(text)',
    'employer_view_original(text)', 'employer_decide_original(text,text)'
  ],
  /* إجباري على كل دالة SECURITY DEFINER */
  requireSearchPathOnDefiner: true
};

/* ── 1) قراءة البصمة من ملف المخطط (تحليل نصي مسنود بتحقق PGlite) ───────
   نستخدم الملف لا القاعدة هنا كي تعمل الأداة في CI بلا تثبيت PGlite.
   والاختبار tests/function-acl-audit.mjs هو من يثبت أن الملف يُنفَّذ فعلاً. */
function parseSchema() {
  const raw = read(SCHEMA);
  const bodies = [];
  const structure = raw.replace(/\$([a-zA-Z_]*)\$([\s\S]*?)\$\1\$/g, () => {
    bodies.push('');
    return ' §BODY ';
  });

  /* كل تعريف دالة + خصائصها */
  const funcs = new Map();
  /* الحيلة: الأجساد استُبدلت بـ §BODY، فيصير `as §BODY` علامة نهاية موثوقة.
     التوقيع قد يمتد أسطراً (كل وسيط في سطر) وخصائص الدالة قد تمتد أكثر. */
  const defRe = /create\s+or\s+replace\s+function\s+([a-z_.]+)\s*\(([^)]*)\)([\s\S]{0,900}?)\bas\s+§BODY/gi;
  for (const m of structure.matchAll(defRe)) {
    const name = m[1].toLowerCase();
    const args = m[2].split(',').map((s) => {
      let t = s.replace(/\s+default\s+[\s\S]*/i, '').trim();
      if (/^[a-z_][a-z0-9_]*\s+/.test(t)) t = t.replace(/^[a-z_][a-z0-9_]*\s+/, '');
      return t.replace(/\s+/g, '').toLowerCase();
    }).filter(Boolean).join(',');
    funcs.set(`${name}(${args})`, {
      name: `${name}(${args})`,
      definer: /security\s+definer/i.test(m[3]),
      searchPath: /set\s+search_path/i.test(m[3])
    });
  }

  const grants = new Map(); // fn -> { anon:bool, authenticated:bool, public:bool }
  const touch = (fn) => {
    const key = fn.toLowerCase();
    if (!grants.has(key)) grants.set(key, { anon: false, authenticated: false, public: false });
    return grants.get(key);
  };
  const norm = (s) => s.split(',').map((x) => x.trim().replace(/\s+/g, '').toLowerCase()).filter(Boolean).join(',');

  for (const m of structure.matchAll(/(grant\s+(?:execute|all)|revoke\s+(?:all|execute))\s+on\s+function\s+([a-z_.]+)\s*\(([^)]*)\)\s+(from|to)\s+([^;]+);/gi)) {
    const isGrant = /^grant/i.test(m[1]);
    const g = touch(`${m[2]}(${norm(m[3])})`);
    for (const role of m[5].split(',').map((r) => r.trim().toLowerCase())) {
      if (role === 'public') g.public = isGrant;
      if (role === 'anon') g.anon = isGrant;
      if (role === 'authenticated') g.authenticated = isGrant;
    }
  }
  /* السحب الشامل يسحب من public كل الدوال — اقرأه كسياسة عامة */
  const blanketRevoke = /alter\s+default\s+privileges\s+revoke\s+execute\s+on\s+functions\s+from\s+public/i.test(structure);
  return { funcs, grants, blanketRevoke, functionCount: funcs.size };
}

export function captureBaseline() {
  const { funcs, grants, blanketRevoke, functionCount } = parseSchema();
  const fns = [...funcs.values()].map((f) => {
    const g = grants.get(f.name) || { anon: false, authenticated: false, public: false };
    return {
      name: f.name,
      definer: f.definer,
      searchPath: f.searchPath,
      /* after a blanket revoke the effective PUBLIC state is «revoked» unless re-granted */
      publicExecute: blanketRevoke ? false : g.public,
      anon: g.anon,
      authenticated: g.authenticated
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    schemaBytes: Buffer.byteLength(read(SCHEMA), 'utf8'),
    functionCount,
    blanketRevokeInPlace: blanketRevoke,
    functions: fns,
    policy: POLICY
  };
}

/* ── 2) المقارنة: كل انحراف يُشرح بلغة تُقرأ ─────────────────────────── */
const label = (name) => name.replace('brc.', '');

export function compare(baseline, current = captureBaseline()) {
  const findings = [];
  const add = (severity, kind, detail) => findings.push({ severity, kind, detail });

  const cur = new Map(current.functions.map((f) => [f.name, f]));
  const base = new Map(baseline.functions.map((f) => [f.name, f]));

  /* 2.1 دالة جديدة ظهرت — أخطر انحراف: قد تكون مفتوحة افتراضياً */
  for (const [name, f] of cur) {
    if (!base.has(name)) {
      add(f.publicExecute ? 'critical' : 'info', 'دالة جديدة',
        label(name) + (f.publicExecute ? ' — تحمل EXECUTE على PUBLIC (ثغرة محتملة)' : ' — مضافة بلا منح عام'));
    }
  }
  /* 2.2 دالة اختفت — قد تكون كُسرت واجهة تستدعيها */
  for (const [name] of base) {
    if (!cur.has(name)) add('warning', 'دالة مفقودة', label(name) + ' — موجودة في الـ baseline وغائبة الآن');
  }
  /* 2.3 تراجع في الإبطال: PUBLIC عاد */
  for (const [name, f] of cur) {
    const b = base.get(name);
    if (!b) continue;
    if (!b.publicExecute && f.publicExecute) add('critical', 'تراجع ACL', label(name) + ' — صار PUBLIC ينفّذها');
    if (b.publicExecute && !f.publicExecute) add('info', 'تحسين ACL', label(name) + ' — أُغلقت عن PUBLIC');
    if (!b.anon && f.anon) add('critical', 'منح زائد للزائر', label(name) + ' — صار الزائر يناديها');
    if (b.anon && !f.anon) add('warning', 'منح مسحوب من الزائر', label(name) + ' — قد يكسر مسار زبون');
    if (!b.authenticated && f.authenticated) add('warning', 'منح زائد للموظف', label(name));
    if (b.authenticated && !f.authenticated) add('warning', 'منح مسحوب من الموظف', label(name) + ' — قد يكسر مسار موظف');
  }
  /* 2.4 SECURITY DEFINER بلا search_path — ثغرة اختطاف دوال */
  if (POLICY.requireSearchPathOnDefiner) {
    for (const f of current.functions) {
      if (f.definer && !f.searchPath && !/^brc\.trg_/.test(f.name)) {
        add('critical', 'search_path', label(f.name) + ' — SECURITY DEFINER بلا search_path ثابت');
      }
    }
  }
  /* 2.5 مطابقة القائمة البيضاء للسياسة */
  const anonAllowed = new Set(POLICY.anon.map((s) => 'brc.' + s));
  const anonAllowedBare = new Set(POLICY.anon);
  for (const f of current.functions) {
    if (f.anon && !anonAllowed.has(f.name) && !anonAllowedBare.has(label(f.name))) {
      add('critical', 'خارج السياسة', label(f.name) + ' — ممنوحة للزائر وليست في مسارات الزبون');
    }
  }
  for (const want of POLICY.anon) {
    const found = current.functions.find((f) => f.name === 'brc.' + want || label(f.name) === want);
    if (found && !found.anon) add('critical', 'مسار مكسور', label(want) + ' — في السياسة ولا تُمنح للزائر');
  }
  for (const forbidden of POLICY.never_client) {
    const found = current.functions.find((f) => f.name === 'brc.' + forbidden || label(f.name) === forbidden);
    if (found && f2reachesClient(found)) add('critical', 'دالة محرّمة مكشوفة', label(forbidden));
  }

  /* 2.6 ترتيب: الترحيل الأخير هو الحاكم */
  return findings;
}

function f2reachesClient(f) {
  return f.anon || f.authenticated || f.publicExecute;
}

/* ── 3) التحقق من قاعدة حيّة ──────────────────────────────────────────────
   يُمرَّر ملف JSON استُخرج من القاعدة الحيّة (انظر docs/security-audit.sql):
     { "functions": [ { "name": "...", "publicExecute": false,
                        "anon": false, "authenticated": true } ... ] }
   نقارنها بالسياسة **لا** بالـ baseline: القاعدة الحيّة قد تكون أقدم أو أحدث،
   والسياسة هي الحكم. */
export function verifyLive(live) {
  const findings = [];
  const add = (severity, kind, detail) => findings.push({ severity, kind, detail });
  const fns = Array.isArray(live?.functions) ? live.functions : [];
  if (!fns.length) {
    add('critical', 'مدخلات', 'ملف البصمة الحيّة لا يحوي قائمة functions');
    return findings;
  }
  const byName = new Map(fns.map((f) => [String(f.name).toLowerCase(), f]));

  /* 3.1 لا PUBLIC على أي دالة */
  for (const f of fns) {
    if (f.publicExecute === true) add('critical', 'PUBLIC مفتوح', f.name + ' — EXECUTE على PUBLIC');
  }
  /* 3.2 كل مسار زبون يعمل */
  const anonSet = new Set(fns.filter((f) => f.anon).map((f) => String(f.name).toLowerCase()));
  for (const want of POLICY.anon) {
    const hit = [...anonSet].some((n) => n === want || n === 'brc.' + want || n.endsWith('.' + want));
    if (!hit) add('critical', 'مسار زبون معطّل', want + ' — الزائر لا يستطيع نداءها');
  }
  for (const n of anonSet) {
    const bare = n.replace(/^brc\./, '');
    if (!POLICY.anon.includes(bare)) add('critical', 'منح زائد للزائر', bare);
  }
  /* 3.3 المحرّمة */
  for (const forbidden of POLICY.never_client) {
    const f = byName.get('brc.' + forbidden) || byName.get(forbidden);
    if (f && (f.anon || f.authenticated || f.publicExecute)) {
      add('critical', 'دالة محرّمة مكشوفة', forbidden);
    }
  }
  return findings;
}

/* ── 4) الإبلاغ ────────────────────────────────────────────────────────── */
const ICON = { critical: '⛔', warning: '⚠️ ', info: 'ℹ️ ' };
const ORDER = { critical: 0, warning: 1, info: 2 };

function report(findings, title) {
  console.log('\n' + '═'.repeat(74));
  console.log('  ' + title);
  console.log('═'.repeat(74));
  if (!findings.length) {
    console.log('\n  ✅ لا انحراف عن سياسة الأمان');
    console.log('═'.repeat(74) + '\n');
    return 0;
  }
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  for (const f of sorted) console.log('  ' + ICON[f.severity] + ' [' + f.kind + '] ' + f.detail);
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;
  console.log('\n  الحصيلة: ' + critical + ' حرج · ' + warning + ' تحذير · ' +
    (findings.length - critical - warning) + ' معلومات');
  console.log('═'.repeat(74) + '\n');
  return critical > 0 ? 1 : 0;
}

/* ── 5) CLI ────────────────────────────────────────────────────────────── */
function main() {
  const mode = arg('--capture') ? 'capture'
    : arg('--compare') ? 'compare'
    : arg('--verify') ? 'verify'
    : process.argv[2] === '--capture' ? 'capture'
    : process.argv[2] === '--compare' ? 'compare'
    : process.argv[2] === '--verify' ? 'verify'
    : null;

  if (mode === 'capture') {
    const snap = captureBaseline();
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(snap, null, 2) + '\n');
    console.log('✓ تم التقاط البصمة: docs/security-baseline.json');
    console.log('  دوال: ' + snap.functionCount + ' · سحب شامل من PUBLIC: ' + (snap.blanketRevokeInPlace ? 'نعم' : 'لا'));
    const leaky = snap.functions.filter((f) => f.publicExecute);
    console.log('  دوال تحمل PUBLIC: ' + leaky.length);
    return 0;
  }

  if (mode === 'compare') {
    if (!existsSync(BASELINE)) {
      console.log('✗ لا يوجد baseline — شغّل: node tools/security-monitor.mjs --capture');
      return 2;
    }
    const baseline = JSON.parse(read(BASELINE));
    const findings = compare(baseline);
    /* معلومات فقط (تحسينات) لا تُفشل الفحص؛ الحرجة والتحذيرات تُفشل */
    return report(findings, 'مراقبة سياسة الأمان — مقارنة بالـ baseline') === 0
      ? (findings.some((f) => f.severity === 'warning') ? 1 : 0)
      : 1;
  }

  if (mode === 'verify') {
    const file = arg('--verify');
    const path = typeof file === 'string' ? file : null;
    if (!path) { console.log('✗ استعمل: --verify <ملف.json>'); return 2; }
    let live;
    try { live = JSON.parse(read(path)); }
    catch (e) { console.log('✗ تعذّر قراءة الملف: ' + e.message); return 2; }
    return report(verifyLive(live), 'تحقق من قاعدة حيّة — ' + path);
  }

  console.log(`أداة مراقبة سياسات الأمان — HRC

  --capture              التقاط بصمة السياسة من docs/schema.sql إلى baseline
  --compare              مقارنة الوضع الحالي بالـ baseline (يفشل عند أي انحراف حرج)
  --verify <live.json>    التحقق من بصمة قاعدة Supabase حيّة مقابل السياسة

  استخراج البصمة الحيّة: نفّذ docs/security-audit.sql على القاعدة الحيّة
  والصق ناتجه في ملف JSON بالشكل:
    {"functions":[{"name":"brc.lookup_card(text,text)","publicExecute":false,
                   "anon":true,"authenticated":true}]}
`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
