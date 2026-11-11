/* ===========================================================================
 *  HRC — نواة إعادة التحقق الفوري (مشتركة بين الحافة والمعاينة المحلية)
 *  ---------------------------------------------------------------------------
 *  نفس المنطق يعمل في مكانين:
 *    • functions/api/revalidate.js  → Cloudflare Pages Function (الإنتاج)
 *    • tools/serve.mjs              → معاينة محلية على /api/revalidate
 *
 *  لماذا ملف مشترك؟ لأن فرق السلوك بين المعاينة والإنتاج هو أشهر سبب لخلل
 *  يظهر بعد النشر فقط. هنا المنطق واحد، والاختلاف في طبقة الكاش وحدها.
 *
 *  الوحدة صافية (بلا Node ولا Cloudflare APIs) كي تختبرها مباشرة.
 * =========================================================================== */

export const MAX_SKEW_MS = 5 * 60 * 1000;
export const TARGETS = ['/rest/v1/public_jobs'];

/* مقارنة بزمن ثابت — لا تتوقف عند أول اختلاف */
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* يوقّع طلباً كما تفعل لوحة التحكم. يُستخدم في الاختبارات وللاختبار اليدوي. */
export async function signRequest(secret, payload, atMs) {
  const ts = String(atMs == null ? Date.now() : atMs);
  const body = payload == null ? '' : String(payload);
  return { ts: ts, signature: await hmacHex(secret, ts + '.' + body), body: body };
}

/* التحقق الكامل. يعيد { ok, status, error, paths } بلا أي آثار جانبية. */
export async function verifyRequest({ secret, headers, payload, nowMs }) {
  if (!secret) return { ok: false, status: 503, error: 'لم يُضبط HRC_REVALIDATE_SECRET' };

  const get = (name) => (headers && typeof headers.get === 'function'
    ? headers.get(name)
    : (headers && headers[name]) || null);

  const ts = get('x-hrc-timestamp') || '';
  const sig = get('x-hrc-signature') || '';
  const body = payload == null ? '' : String(payload);
  const now = nowMs == null ? Date.now() : nowMs;

  const stamp = Number(ts);
  if (!stamp || !isFinite(stamp) || Math.abs(now - stamp) > MAX_SKEW_MS) {
    return { ok: false, status: 401, error: 'طابع زمني منتهٍ أو مفقود' };
  }

  const expected = await hmacHex(secret, ts + '.' + body);
  if (!safeEqual(sig, expected)) return { ok: false, status: 401, error: 'توقيع غير صالح' };

  let wanted = TARGETS.slice();
  if (body) {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { return { ok: false, status: 400, error: 'جسم الطلب ليس JSON' }; }
    if (parsed && Array.isArray(parsed.paths) && parsed.paths.length) {
      wanted = parsed.paths.filter((p) => TARGETS.indexOf(p) >= 0);
      if (!wanted.length) return { ok: false, status: 400, error: 'لا مسار معروف في الطلب' };
    }
  }
  return { ok: true, status: 200, paths: wanted };
}
