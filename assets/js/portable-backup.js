/* ═══════════════════════════════════════════════════════════════════════════
   HRC — حزمة النسخة المحمولة (Portable Backup)
   ---------------------------------------------------------------------------
   تُشفّر النسخة في **المتصفح** بمفتاح مُشتق من كلمة مرور يختارها المالك،
   فلا يمرّ المفتاح بالقاعدة ولا يُخزَّن فيها. هذا ما يجعل النسخة قابلة
   للاسترجاع بعد فقدان القاعدة نفسها — بخلاف brc.recovery_copies التي
   تُشفَّر بمفتاح داخلها.

   التنسيق: HRC-BACKUP/1
     • PBKDF2-SHA256 · 310000 دورة · ملح 16 بايت عشوائي
     • AES-256-GCM · متجه 12 بايت عشوائي · وسم مصادقة 16 بايت
     • الغلاف نصّي (JSON) كي يُقبل بملحق .json ويُفتح بأي محرّر بلا فهم
       للمحتوى، وبملحق .hrcbak للتمييز البصري.

   ⛔ لا يُستدعى من أي صفحة عامة. يُحمَّل عند الطلب فقط.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var FORMAT = 'HRC-BACKUP/1';
  var KDF = 'PBKDF2-SHA256';
  var CIPHER = 'AES-256-GCM';
  var ITERATIONS = 310000;          /* توصية OWASP 2023 لـ PBKDF2-SHA256 */
  var MIN_PASSWORD = 10;
  var MAX_INPUT = 128 * 1024 * 1024;

  var subtle = root.crypto && root.crypto.subtle;
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function fail(msg) { throw new Error(msg); }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else fail('المتصفح لا يوفّر مولّد أرقام عشوائية آمناً');
    return b;
  }

  function toB64(bytes) {
    var a = new Uint8Array(bytes), out = '';
    for (var i = 0; i < a.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    }
    return root.btoa(out);
  }

  function fromB64(s) {
    var bin = root.atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  /* المفتاح يُشتق مرة واحدة؛ لا يُخزَّن ولا يُسجَّل ولا يخرج من هذه الدالة. */
  function deriveKey(password, salt, iterations) {
    return subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,                       /* non-extractable: لا يمكن تصدير المفتاح */
          ['encrypt', 'decrypt']
        );
      });
  }

  /* Sha-256 للتحقق من سلامة الحمولة بعد فك التشفير. */
  function sha256Hex(bytes) {
    return subtle.digest('SHA-256', bytes).then(function (d) {
      var a = new Uint8Array(d), out = '';
      for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
      return out;
    });
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      fail('كلمة المرور قصيرة — الحد الأدنى ' + MIN_PASSWORD + ' محارف');
    }
    if (/^\s+$/.test(password)) fail('كلمة المرور لا يمكن أن تكون فراغاً');
    return password;
  }

  /* ── التشفير ─────────────────────────────────────────────────────────────
     payload: الكائن العائد من brc.recovery_export_full()
     تعيد: غلافاً نصياً جاهزاً للتنزيل. */
  function seal(payload, password) {
    if (!subtle) return Promise.reject(new Error('التشفير يحتاج اتصالاً آمناً (HTTPS) أو localhost'));
    try { validatePassword(password); } catch (e) { return Promise.reject(e); }
    if (!payload || typeof payload !== 'object') return Promise.reject(new Error('بيانات النسخة غير صالحة'));

    var plain = enc.encode(JSON.stringify(payload));
    if (plain.length > MAX_INPUT) return Promise.reject(new Error('حجم النسخة يتجاوز الحد المسموح'));

    var salt = randomBytes(16), iv = randomBytes(12), startedAt = new Date().toISOString();

    return sha256Hex(plain).then(function (checksum) {
      return deriveKey(password, salt, ITERATIONS).then(function (key) {
        return subtle.encrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, key, plain)
          .then(function (sealedBuf) {
            return {
              format: FORMAT,
              kdf: KDF,
              iterations: ITERATIONS,
              cipher: CIPHER,
              salt: toB64(salt),
              iv: toB64(iv),
              checksum: checksum,
              sealedAt: startedAt,
              bytes: plain.length,
              counts: payload.counts || null,
              /* الحمولة: ciphertext + وسم GCM في نهاية الحزمة */
              data: toB64(new Uint8Array(sealedBuf))
            };
          });
      });
    });
  }

  /* ── فك التشفير ──────────────────────────────────────────────────────────
     يعيد { payload, meta } أو يرفض برسالة عربية واضحة. */
  /* ═══ تنظيف النصّ قبل التحليل ═══════════════════════════════════════════
     ⚠️ عطل حقيقي أُصلح 2026-11-15 (بلاغ المالك: «أكتب نفس رمز النسخة
     ويفكّ التشفير يقول خطأ» — والسبب ليس الرمز):

       BOM (\uFEFF) في أول الملف يُسقط JSON.parse فوراً برسالة
       «الملف ليس نسخة صالحة». ويُضاف BOM تلقائياً في حالات واقعية:
       فتح الملف في Notepad وحفظه، أو نسخه عبر أداة، أو تحريره.

     ولا يحمي منه شيء في المسار الحالي. فالتنظيف هنا — قبل التحليل.
     كما نتعامل مع مسافات زائدة وأسطر CRLF (Windows) بلا ضرر. */
  function cleanText(text) {
    return String(text)
      .replace(/^\uFEFF/, '')            /* BOM */
      .replace(/^[\s\u200B\u200E\u200F]+/, '')
      .trim();
  }

  function open(envelope, password) {
    if (!subtle) return Promise.reject(new Error('فك التشفير يحتاج اتصالاً آمناً (HTTPS) أو localhost'));

    var env;
    try {
      env = typeof envelope === 'string' ? JSON.parse(cleanText(envelope)) : envelope;
    } catch (e) {
      return Promise.reject(new Error('الملف ليس نسخة صالحة — تعذّرت قراءته'));
    }

    if (!env || env.format !== FORMAT) {
      return Promise.reject(new Error('إصدار ملف غير مدعوم — هذا الملف ليس نسخة ' + FORMAT));
    }
    if (env.cipher !== CIPHER || env.kdf !== KDF) {
      return Promise.reject(new Error('خوارزمية التشفير في الملف غير معروفة'));
    }
    var iterations = Number(env.iterations);
    if (!Number.isFinite(iterations) || iterations < 100000 || iterations > 2000000) {
      return Promise.reject(new Error('عدد دورات الاشتقاق غير مقبول — الملف معدَّل أو تالف'));
    }
    if (typeof password !== 'string' || !password.length) {
      return Promise.reject(new Error('أدخل كلمة المرور'));
    }

    var salt, iv, data;
    try {
      salt = fromB64(env.salt);
      iv = fromB64(env.iv);
      data = fromB64(env.data);
    } catch (e) {
      return Promise.reject(new Error('حمولة الملف تالفة — تعذّر فكّها'));
    }
    if (salt.length < 16 || iv.length !== 12 || data.length < 17) {
      return Promise.reject(new Error('حمولة الملف تالفة أو مبتورة'));
    }

    return deriveKey(password, salt, iterations).then(function (key) {
      return subtle.decrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, key, data)
        .catch(function () {
          /* ⚠️ GCM لا يفرّق بين «كلمة مرور خاطئة» و«ملف تغيّر» — ولا يجوز أن
             نفرّق أمنياً (التفريق يمنح المهاجم إشارة).

             لكن المالك كان يرى «كلمة المرور غير صحيحة» فيتّهم نفسه، ويكتب
             الرمز مراراً. والسبب في أغلب الحالات **ليس الرمز** بل الملف:
             بُتر أثناء الكتابة على USB، أو تغيّر ترميزه، أو حُرّر.

             فنعطي تشخيصاً **بلا كشف**: نذكر الاحتمالين معاً، ونطبع أرقاماً
             يراها المالك ويقارنها بما في الملف — هذه ليست سرّاً. */
          var hint = 'الطول ' + password.length + ' محرفاً' +
            ' · الحمولة ' + data.length + ' بايتاً' +
            ' · دورات ' + iterations;
          throw new Error('كلمة المرور غير صحيحة، أو أن الملف تغيّر بعد تنزيله (' + hint + ')');
        })
        .then(function (plainBuf) {
          var bytes = new Uint8Array(plainBuf);
          return sha256Hex(bytes).then(function (checksum) {
            if (env.checksum && checksum !== env.checksum) {
              throw new Error('بصمة البيانات لا تطابق الملف — النسخة معدَّلة');
            }
            var payload;
            try { payload = JSON.parse(dec.decode(bytes)); }
            catch (e) { throw new Error('محتوى النسخة غير صالح بعد فك التشفير'); }
            return {
              payload: payload,
              meta: {
                sealedAt: env.sealedAt || null,
                iterations: iterations,
                bytes: bytes.length,
                checksum: checksum,
                counts: env.counts || null
              }
            };
          });
        });
    });
  }

  /* ── فحص الغلاف بلا كلمة مرور ────────────────────────────────────────────
     يُظهر ما في الملف قبل أن يكتب المستخدم كلمة المرور. لا يفكّ شيئاً. */
  function inspect(envelope) {
    var env;
    try { env = typeof envelope === 'string' ? JSON.parse(cleanText(envelope)) : envelope; }
    catch (e) { return { ok: false, error: 'الملف ليس JSON صالحاً' }; }
    if (!env || env.format !== FORMAT) {
      return { ok: false, error: 'ليس ملف نسخة ' + FORMAT };
    }
    return {
      ok: true,
      format: env.format,
      cipher: env.cipher,
      kdf: env.kdf,
      iterations: env.iterations,
      sealedAt: env.sealedAt || null,
      bytes: env.bytes || null,
      counts: env.counts || null
    };
  }

  /* اسم ملف مقترح: تاريخ بتنظيم YYYY-MM-DD-HHmm */
  function suggestName(date) {
    var d = date || new Date();
    function p(n) { return ('0' + n).slice(-2); }
    return 'hrc-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + '.hrcbak';
  }

  root.HRCPortableBackup = {
    FORMAT: FORMAT,
    CIPHER: CIPHER,
    KDF: KDF,
    ITERATIONS: ITERATIONS,
    MIN_PASSWORD: MIN_PASSWORD,
    seal: seal,
    open: open,
    inspect: inspect,
    suggestName: suggestName,
    /* للاختبارات: هل التشفير متاح في هذه البيئة؟ */
    available: function () { return !!subtle; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
