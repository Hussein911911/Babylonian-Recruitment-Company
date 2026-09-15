/* ===========================================================================
 *  BRC — عميل HTTP مصغّر للصفحات العامة (BRCHttp)
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

    function headers(write) {
      var h = {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json'
      };
      /* السكيما تُعلَن في الترويسة: بلا Accept-Profile يقرأ PostgREST من
         public دائماً فيرد PGRST205 «جدول غير موجود» — وهو أشهر خطأ إعداد. */
      h[write ? 'Content-Profile' : 'Accept-Profile'] = schema;
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

    function request(method, path, body, write) {
      var init = { method: method, headers: headers(write) };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      return fetch(base + path, init).then(function (res) {
        return res.text().then(function (txt) {
          if (!res.ok) return { data: null, error: toError(res.status, txt), status: res.status };
          var data = null;
          if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
          return { data: data, error: null, status: res.status };
        });
      }).catch(function (e) {
        return { data: null, error: { message: 'تعذّر الاتصال: ' + (e && e.message || e), code: 'NETWORK' } };
      });
    }

    /* نفس واجهة supabase-js للمسار العام: from(t).select(c).eq(..).limit(..) */
    function from(table) {
      var q = { cols: '*', filters: [], limit: null, order: null };
      var api = {
        select: function (cols) { if (cols) q.cols = cols; return api; },
        eq: function (col, val) { q.filters.push(col + '=' + encodeURIComponent(val)); return api; },
        order: function (col, o) {
          q.order = col + '.' + ((o && o.ascending === false) ? 'desc' : 'asc');
          return api;
        },
        limit: function (n) { q.limit = n; return api; },
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
        return request('GET', table + '?' + qs.join('&'), undefined, false);
      }
      return api;
    }

    function rpc(name, args) {
      return request('POST', 'rpc/' + name, args || {}, true);
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

  root.BRCHttp = { createClient: createClient };
})(typeof window !== 'undefined' ? window : globalThis);
