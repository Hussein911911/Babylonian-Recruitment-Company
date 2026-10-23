/* ===========================================================================
 *  HRC — عميل HTTP مصغّر للصفحات العامة (HRCHttp)
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف موجود؟ قياس الحجم كشف أن **كل زائر** للموقع العام ينزّل
 *  assets/vendor/supabase.js (213KB خام · 54KB مضغوط) — أي ثلث ما ينزّله الزائر
 *  بالضبط — وهو يحتاج منه شيئين فقط: قراءة brc.public_jobs، واستدعاء دالتَي
 *  verify_form و request_form.
 *
 *  مكتبة سوبابيس كاملة ضرورية في **لوحة الموظفين** وحدها (لأنها تحتاج تسجيل
 *  الدخول وإدارة الجلسة والاتصال اللحظي Realtime)، أما الزائر فلا مصلحة له بها.
 *
 *  فهذا عميل بلا أي تبعية (~2KB) يتكلم PostgREST مباشرة بنفس الشكل الذي تتوقّعه
 *  cloud.js (`from(...).select(...)' و 'rpc(...)`) — فلا يلمس أي منطق قائم.
 *
 *  ⚠️ لا يوفّر تسجيل دخول ولا قناة لحظية عن قصد: صلاحياته صلاحيات الزائر
 *     (المفتاح العام)، وهذا ما يجب أن يكون في صفحة عامة.
 * =========================================================================== */
(function (root) {
  'use strict';

  function createClient(url, key, opts) {
    opts = opts || {};
    var schema = opts.schema || 'brc';
    var base = String(url).replace(/\/+$/, '') + '/rest/v1/';

    function headers(write, both) {
      var h = {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json'
      };
      /* السكيما تُعلَن في الترويسة: بلا Accept-Profile يقرأ PostgREST من
         public دائماً فيرد PGRST205 «جدول غير موجود» — وهو أشهر خطأ إعداد. */
      if (both) {
        /* نداءات RPC تحتاج الترويستين معاً: PostgREST يبحث عن الدالة بموجب
           Accept-Profile — أما Content-Profile وحده فيترك البحث في public
           فيرد PGRST202 «Could not find the function public.… in the schema
           cache» رغم أن الدالة موجودة بسكيما brc (انظر tests/cloud-http.mjs). */
        h['Accept-Profile'] = schema;
        h['Content-Profile'] = schema;
      } else h[write ? 'Content-Profile' : 'Accept-Profile'] = schema;
      return h;
    }

    function toError(status, body) {
      var msg = 'HTTP ' + status;
      var code = '';
      try {
        var j = typeof body === 'string' ? JSON.parse(body) : body;
        if (j && j.message) msg = j.message;
        if (j && j.code) code = j.code;
        if (j && j.hint && !code) msg += ' — ' + j.hint;
      } catch (e) { /* نص غير JSON */ }
      return { message: msg, code: code || ('HTTP_' + status) };
    }

    /* مهلة الاتصال: بلا سقف كان أي اتصال متعثّر يُبقي الزائر على «جارٍ التحميل»
       إلى ما لا نهاية. الآن يفشل بوضوح بعد `timeout` ويُعيد المحاولة مرة واحدة
       عند خطأ شبكة عابر (لا عند خطأ قاعدة حقيقي). */
    var TIMEOUT_MS = opts.timeout || 15000;

    function once(url, init) {
      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = null;
      if (ctrl) {
        init.signal = ctrl.signal;
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, TIMEOUT_MS);
      }
      return fetch(url, init).then(function (res) {
        if (timer) clearTimeout(timer);
        return res.text().then(function (txt) {
          if (!res.ok) return { data: null, error: toError(res.status, txt), status: res.status };
          var data = null;
          if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
          var cr = res.headers && res.headers.get('content-range');
          var total = cr && /\/(\d+)$/.exec(cr);
          var result = { data: data, error: null, status: res.status };
          if (total) result.count = Number(total[1]);
          return result;
        });
      }, function (e) {
        if (timer) clearTimeout(timer);
        var aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
        return { data: null, error: { code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? 'انتهت مهلة الاتصال' : ('تعذّر الاتصال: ' + (e && e.message || e)) }, network: true };
      });
    }

    function request(method, path, body, write, both, exactCount) {
      var init = { method: method, headers: headers(write, both) };
      if (exactCount) init.headers.Prefer = 'count=exact';
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      var url = base + path;
      return once(url, init).then(function (r) {
        /* إعادة محاولة واحدة للأخطاء الشبكية/المهلة في قراءات GET فقط */
        if (!r.network || method !== 'GET') return r;
        return once(url, init).then(function (r2) {
          if (r2.network) {
            r2.error.message = r2.error.code === 'TIMEOUT'
              ? 'انتهت مهلة الاتصال بقاعدة الشركة — تحقّق من الإنترنت وأعد المحاولة.'
              : 'تعذّر الاتصال بقاعدة الشركة — تحقّق من الإنترنت وأعد المحاولة.';
          }
          return r2;
        });
      });
    }

    /* نفس واجهة supabase-js للمسار العام: from(t).select(c).eq(..).limit(..) */
    function from(table) {
      var q = { cols: '*', filters: [], limit: null, order: null, offset: null, exactCount: false };
      var api = {
        select: function (cols, options) { if (cols) q.cols = cols; q.exactCount = !!(options && options.count === 'exact'); return api; },
        eq: function (col, val) { q.filters.push(col + '=' + encodeURIComponent(val)); return api; },
        order: function (col, o) {
          q.order = col + '.' + ((o && o.ascending === false) ? 'desc' : 'asc');
          return api;
        },
        limit: function (n) { q.limit = n; return api; },
        range: function (from, to) { q.offset = from; q.limit = to - from + 1; return api; },
        single: function () { return run().then(function (r) {
          if (r.error) return r;
          var rows = Array.isArray(r.data) ? r.data : [];
          return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'لا نتيجة', code: 'PGRST116' } };
        }); },
        then: function (a, b) { return run().then(a, b); },
        catch: function (b) { return run().catch(b); }
      };
      function run() {
        var qs = ['select=' + encodeURIComponent(q.cols)].concat(q.filters);
        if (q.order) qs.push('order=' + encodeURIComponent(q.order));
        if (q.limit != null) qs.push('limit=' + q.limit);
        if (q.offset != null) qs.push('offset=' + q.offset);
        return request('GET', table + '?' + qs.join('&'), undefined, false, false, q.exactCount);
      }
      return api;
    }

    function rpc(name, args) {
      return request('POST', 'rpc/' + name, args || {}, true, true);
    }

    /* لا جلسة ولا مصادقة في هذا العميل — وهو المقصود: صلاحيات الزائر فقط */
    return {
      from: from,
      rpc: rpc,
      schema: schema,
      __mini: true,
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); }
      }
    };
  }

  root.HRCHttp = { createClient: createClient };
})(typeof window !== 'undefined' ? window : globalThis);
