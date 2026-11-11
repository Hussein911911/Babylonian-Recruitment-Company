/* ===========================================================================
 *  HRC — مسار إعادة التحقق الفوري (On-Demand Revalidation)
 *  ---------------------------------------------------------------------------
 *  Cloudflare Pages Function: يعمل على الحافة بلا خادم Node، ويُستدعى من
 *  لوحة التحكم فور أي تعديل على الوظائف (إضافة/تعديل/إغلاق/حجز).
 *
 *  ⚠️ لماذا هنا وليس في tools/serve.mjs؟
 *     النشر المعتمد Cloudflare Pages (ساكن). لا يوجد خادم Node في الإنتاج،
 *     فأي مسار API يجب أن يكون Pages Function. tools/serve.mjs للمعاينة
 *     المحلية فقط ويحاكي هذا المسار بنفس السلوك (انظر tools/revalidate.mjs).
 *
 *  الأمان:
 *    • لا مفاتيح في الكود — تُقرأ من متغيّرات بيئة Cloudflare:
 *      HRC_REVALIDATE_SECRET (إلزامي) و HRC_ALLOWED_ORIGIN (اختياري).
 *    • التوقيع HMAC-SHA256 على (طابع زمني + جسم الطلب) لمنع إعادة التشغيل.
 *    • نافذة 5 دقائق فقط؛ الطلب الأقدم أو المكرر يُرفض.
 *    • مقارنة بزمن ثابت (لا تكشف عدد الأحرف المطابقة).
 *
 *  على ماذا يعمل؟
 *    لا يعيد بناء الموقع. يحذف مفاتيح الكاش المطابقة من CDN الحافة
 *    (caches.default) ويعيد جلبها، فتصل النسخة الجديدة لكل الزوار فوراً.
 * =========================================================================== */

const MAX_SKEW_MS = 5 * 60 * 1000;         /* نافذة قبول الطابع الزمني */
const TARGETS = ['/rest/v1/public_jobs'];   /*ما يُعاد التحقق منه */

/* مقارنة بزمن ثابت: لا تتوقف عند أول اختلاف */
function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, extra || {})
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const secret = env && env.HRC_REVALIDATE_SECRET;
  if (!secret) {
    /* بلا سرّ مضبوط لا نفتح المسار إطلاقاً — لا نعود لدالة صامتة. */
    return json({ ok: false, error: 'لم يُضبط HRC_REVALIDATE_SECRET على Cloudflare' }, 503);
  }

  const ts = request.headers.get('x-hrc-timestamp') || '';
  const sig = request.headers.get('x-hrc-signature') || '';
  let payload = '';
  try { payload = await request.text(); } catch (e) { payload = ''; }

  /* 1) نافذة زمنية */
  const stamp = Number(ts);
  if (!stamp || Math.abs(Date.now() - stamp) > MAX_SKEW_MS) {
    return json({ ok: false, error: 'طابع زمني منتهٍ أو مفقود' }, 401);
  }

  /* 2) التوقيع */
  const expected = await hmacHex(secret, ts + '.' + payload);
  if (!safeEqual(sig, expected)) {
    return json({ ok: false, error: 'توقيع غير صالح' }, 401);
  }

  /* 3) الجسم: إمّا فارغ (كل الأهداف) أو قائمة مسارات محدّدة */
  let wanted = TARGETS.slice();
  if (payload) {
    let parsed = null;
    try { parsed = JSON.parse(payload); } catch (e) { return json({ ok: false, error: 'جسم الطلب ليس JSON' }, 400); }
    if (parsed && Array.isArray(parsed.paths) && parsed.paths.length) {
      /* نقبل فقط المسارات المعروفة — لا نسمح بحذف كاش أي شيء آخر */
      wanted = parsed.paths.filter((p) => TARGETS.indexOf(p) >= 0);
      if (!wanted.length) return json({ ok: false, error: 'لا مسار معروف في الطلب' }, 400);
    }
  }

  /* 4) الحذف من كاش الحافة + إعادة الجلب في الخلفية */
  const origin = new URL(request.url).origin;
  const purged = [];
  const errors = [];
  for (const path of wanted) {
    const target = origin + path;
    try {
      await caches.default.delete(new Request(target));
      purged.push(path);
    } catch (e) {
      errors.push(path + ': ' + (e && e.message ? e.message : String(e)));
    }
  }

  /* إعادة التعبئة الفورية (لا تنتظر): أول زائر بعد الحذف يجد الكاش دافئاً.
     فشل التعبئة لا يُفشل الطلب — الحذف وحده يكفي لخدمة نسخة جديدة. */
  const warm = context.waitUntil
    ? Promise.all(wanted.map((p) => fetch(origin + p, { cf: { cacheEverything: false } }).catch(() => null)))
    : Promise.resolve();
  if (context.waitUntil) context.waitUntil(warm);

  return json({
    ok: errors.length === 0,
    purged: purged,
    errors: errors,
    at: new Date().toISOString()
  }, errors.length ? 207 : 200);
}

export async function onRequestOptions(context) {
  const origin = (context.env && context.env.HRC_ALLOWED_ORIGIN) || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type, x-hrc-timestamp, x-hrc-signature',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '600'
    }
  });
}
