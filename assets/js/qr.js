/*!
 * BRC QR — مولّد رموز QR مستقل (بدون أي مكتبات خارجية)
 * ---------------------------------------------------------------------------
 * تنفيذ خاص بمشروع شركة الهدف للتوظيف، يعمل بالكامل داخل المتصفح (offline).
 * الخوارزمية والجداول مطابقة للمعيار ISO/IEC 18004 (QR Code Model 2)،
 * وتم التحقق من صحة المخرجات مقارنة بمرجع مستقل ومُفكِّك QR فعلي.
 *
 * الترخيص: كود المشروع الداخلي.
 *
 * الاستخدام:
 *   const qr = BRCQR.encode('https://example.com', 'M');   // L | M | Q | H
 *   BRCQR.renderSVG(qr, { margin: 2 })                     // -> نص SVG
 *   BRCQR.renderCanvas(canvasEl, qr, { size: 320 })        // -> يرسم على Canvas
 *   BRCQR.selfTest()                                       // -> اختبارات ذاتية
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.BRCQR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ======================= 1) الجداول القياسية ======================= */

  /* مستويات تصحيح الخطأ: ترتيب البتات في معلومات التنسيق */
  var EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* مواقع أنماط المحاذاة (Alignment Patterns) لكل نسخة 1..40 */
  var ALIGN_POS = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
  ];

  /* عدد البتات المتبقية (Remainder bits) لكل نسخة 1..40 */
  var REMAINDER_BITS = [
    0,
    7, 7, 7, 7, 7,
    0, 0, 0, 0, 0, 0, 0,
    3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4,
    3, 3, 3, 3, 3, 3, 3,
    0, 0, 0, 0, 0, 0
  ];

  /* جدول كتل ريد-سولومون: [عدد الكتل, الطول الكلي, طول البيانات] لكل (نسخة، مستوى) */
  var RS_BLOCKS = {
  L: [
    /*v01*/ [[1,26,19]],
    /*v02*/ [[1,44,34]],
    /*v03*/ [[1,70,55]],
    /*v04*/ [[1,100,80]],
    /*v05*/ [[1,134,108]],
    /*v06*/ [[2,86,68]],
    /*v07*/ [[2,98,78]],
    /*v08*/ [[2,121,97]],
    /*v09*/ [[2,146,116]],
    /*v10*/ [[2,86,68], [2,87,69]],
    /*v11*/ [[4,101,81]],
    /*v12*/ [[2,116,92], [2,117,93]],
    /*v13*/ [[4,133,107]],
    /*v14*/ [[3,145,115], [1,146,116]],
    /*v15*/ [[5,109,87], [1,110,88]],
    /*v16*/ [[5,122,98], [1,123,99]],
    /*v17*/ [[1,135,107], [5,136,108]],
    /*v18*/ [[5,150,120], [1,151,121]],
    /*v19*/ [[3,141,113], [4,142,114]],
    /*v20*/ [[3,135,107], [5,136,108]],
    /*v21*/ [[4,144,116], [4,145,117]],
    /*v22*/ [[2,139,111], [7,140,112]],
    /*v23*/ [[4,151,121], [5,152,122]],
    /*v24*/ [[6,147,117], [4,148,118]],
    /*v25*/ [[8,132,106], [4,133,107]],
    /*v26*/ [[10,142,114], [2,143,115]],
    /*v27*/ [[8,152,122], [4,153,123]],
    /*v28*/ [[3,147,117], [10,148,118]],
    /*v29*/ [[7,146,116], [7,147,117]],
    /*v30*/ [[5,145,115], [10,146,116]],
    /*v31*/ [[13,145,115], [3,146,116]],
    /*v32*/ [[17,145,115]],
    /*v33*/ [[17,145,115], [1,146,116]],
    /*v34*/ [[13,145,115], [6,146,116]],
    /*v35*/ [[12,151,121], [7,152,122]],
    /*v36*/ [[6,151,121], [14,152,122]],
    /*v37*/ [[17,152,122], [4,153,123]],
    /*v38*/ [[4,152,122], [18,153,123]],
    /*v39*/ [[20,147,117], [4,148,118]],
    /*v40*/ [[19,148,118], [6,149,119]],
  ],
  M: [
    /*v01*/ [[1,26,16]],
    /*v02*/ [[1,44,28]],
    /*v03*/ [[1,70,44]],
    /*v04*/ [[2,50,32]],
    /*v05*/ [[2,67,43]],
    /*v06*/ [[4,43,27]],
    /*v07*/ [[4,49,31]],
    /*v08*/ [[2,60,38], [2,61,39]],
    /*v09*/ [[3,58,36], [2,59,37]],
    /*v10*/ [[4,69,43], [1,70,44]],
    /*v11*/ [[1,80,50], [4,81,51]],
    /*v12*/ [[6,58,36], [2,59,37]],
    /*v13*/ [[8,59,37], [1,60,38]],
    /*v14*/ [[4,64,40], [5,65,41]],
    /*v15*/ [[5,65,41], [5,66,42]],
    /*v16*/ [[7,73,45], [3,74,46]],
    /*v17*/ [[10,74,46], [1,75,47]],
    /*v18*/ [[9,69,43], [4,70,44]],
    /*v19*/ [[3,70,44], [11,71,45]],
    /*v20*/ [[3,67,41], [13,68,42]],
    /*v21*/ [[17,68,42]],
    /*v22*/ [[17,74,46]],
    /*v23*/ [[4,75,47], [14,76,48]],
    /*v24*/ [[6,73,45], [14,74,46]],
    /*v25*/ [[8,75,47], [13,76,48]],
    /*v26*/ [[19,74,46], [4,75,47]],
    /*v27*/ [[22,73,45], [3,74,46]],
    /*v28*/ [[3,73,45], [23,74,46]],
    /*v29*/ [[21,73,45], [7,74,46]],
    /*v30*/ [[19,75,47], [10,76,48]],
    /*v31*/ [[2,74,46], [29,75,47]],
    /*v32*/ [[10,74,46], [23,75,47]],
    /*v33*/ [[14,74,46], [21,75,47]],
    /*v34*/ [[14,74,46], [23,75,47]],
    /*v35*/ [[12,75,47], [26,76,48]],
    /*v36*/ [[6,75,47], [34,76,48]],
    /*v37*/ [[29,74,46], [14,75,47]],
    /*v38*/ [[13,74,46], [32,75,47]],
    /*v39*/ [[40,75,47], [7,76,48]],
    /*v40*/ [[18,75,47], [31,76,48]],
  ],
  Q: [
    /*v01*/ [[1,26,13]],
    /*v02*/ [[1,44,22]],
    /*v03*/ [[2,35,17]],
    /*v04*/ [[2,50,24]],
    /*v05*/ [[2,33,15], [2,34,16]],
    /*v06*/ [[4,43,19]],
    /*v07*/ [[2,32,14], [4,33,15]],
    /*v08*/ [[4,40,18], [2,41,19]],
    /*v09*/ [[4,36,16], [4,37,17]],
    /*v10*/ [[6,43,19], [2,44,20]],
    /*v11*/ [[4,50,22], [4,51,23]],
    /*v12*/ [[4,46,20], [6,47,21]],
    /*v13*/ [[8,44,20], [4,45,21]],
    /*v14*/ [[11,36,16], [5,37,17]],
    /*v15*/ [[5,54,24], [7,55,25]],
    /*v16*/ [[15,43,19], [2,44,20]],
    /*v17*/ [[1,50,22], [15,51,23]],
    /*v18*/ [[17,50,22], [1,51,23]],
    /*v19*/ [[17,47,21], [4,48,22]],
    /*v20*/ [[15,54,24], [5,55,25]],
    /*v21*/ [[17,50,22], [6,51,23]],
    /*v22*/ [[7,54,24], [16,55,25]],
    /*v23*/ [[11,54,24], [14,55,25]],
    /*v24*/ [[11,54,24], [16,55,25]],
    /*v25*/ [[7,54,24], [22,55,25]],
    /*v26*/ [[28,50,22], [6,51,23]],
    /*v27*/ [[8,53,23], [26,54,24]],
    /*v28*/ [[4,54,24], [31,55,25]],
    /*v29*/ [[1,53,23], [37,54,24]],
    /*v30*/ [[15,54,24], [25,55,25]],
    /*v31*/ [[42,54,24], [1,55,25]],
    /*v32*/ [[10,54,24], [35,55,25]],
    /*v33*/ [[29,54,24], [19,55,25]],
    /*v34*/ [[44,54,24], [7,55,25]],
    /*v35*/ [[39,54,24], [14,55,25]],
    /*v36*/ [[46,54,24], [10,55,25]],
    /*v37*/ [[49,54,24], [10,55,25]],
    /*v38*/ [[48,54,24], [14,55,25]],
    /*v39*/ [[43,54,24], [22,55,25]],
    /*v40*/ [[34,54,24], [34,55,25]],
  ],
  H: [
    /*v01*/ [[1,26,9]],
    /*v02*/ [[1,44,16]],
    /*v03*/ [[2,35,13]],
    /*v04*/ [[4,25,9]],
    /*v05*/ [[2,33,11], [2,34,12]],
    /*v06*/ [[4,43,15]],
    /*v07*/ [[4,39,13], [1,40,14]],
    /*v08*/ [[4,40,14], [2,41,15]],
    /*v09*/ [[4,36,12], [4,37,13]],
    /*v10*/ [[6,43,15], [2,44,16]],
    /*v11*/ [[3,36,12], [8,37,13]],
    /*v12*/ [[7,42,14], [4,43,15]],
    /*v13*/ [[12,33,11], [4,34,12]],
    /*v14*/ [[11,36,12], [5,37,13]],
    /*v15*/ [[11,36,12], [7,37,13]],
    /*v16*/ [[3,45,15], [13,46,16]],
    /*v17*/ [[2,42,14], [17,43,15]],
    /*v18*/ [[2,42,14], [19,43,15]],
    /*v19*/ [[9,39,13], [16,40,14]],
    /*v20*/ [[15,43,15], [10,44,16]],
    /*v21*/ [[19,46,16], [6,47,17]],
    /*v22*/ [[34,37,13]],
    /*v23*/ [[16,45,15], [14,46,16]],
    /*v24*/ [[30,46,16], [2,47,17]],
    /*v25*/ [[22,45,15], [13,46,16]],
    /*v26*/ [[33,46,16], [4,47,17]],
    /*v27*/ [[12,45,15], [28,46,16]],
    /*v28*/ [[11,45,15], [31,46,16]],
    /*v29*/ [[19,45,15], [26,46,16]],
    /*v30*/ [[23,45,15], [25,46,16]],
    /*v31*/ [[23,45,15], [28,46,16]],
    /*v32*/ [[19,45,15], [35,46,16]],
    /*v33*/ [[11,45,15], [46,46,16]],
    /*v34*/ [[59,46,16], [1,47,17]],
    /*v35*/ [[22,45,15], [41,46,16]],
    /*v36*/ [[2,45,15], [64,46,16]],
    /*v37*/ [[24,45,15], [46,46,16]],
    /*v38*/ [[42,45,15], [32,46,16]],
    /*v39*/ [[10,45,15], [67,46,16]],
    /*v40*/ [[20,45,15], [61,46,16]],
  ],
};;

  /* ======================= 2) حساب GF(256) و ريد-سولومون ======================= */

  var EXP = new Array(256), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    EXP[255] = EXP[0];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
  }

  /* مولد حدودي (Generator polynomial) بالدرجة المطلوبة */
  function rsGenerator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];
        next[i + 1] ^= gfMul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly; // أعلى درجة أولاً
  }

  /* حساب بايتات التصحيح لكتلة واحدة */
  function rsEncode(data, ecCount) {
    var gen = rsGenerator(ecCount);
    var res = new Array(ecCount).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      for (var j = 0; j < ecCount; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
  }

  /* ======================= 3) مخزن البتات ======================= */

  function BitBuffer() { this.buffer = []; this.length = 0; }
  BitBuffer.prototype = {
    put: function (num, length) { for (var i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1); },
    putBit: function (b) {
      var idx = Math.floor(this.length / 8);
      if (this.buffer.length <= idx) this.buffer.push(0);
      if (b) this.buffer[idx] |= 0x80 >>> (this.length % 8);
      this.length++;
    }
  };

  /* ======================= 4) أدوات BCH و الأقنعة ======================= */

  var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

  function bchDigit(data) { var d = 0; while (data !== 0) { d++; data >>>= 1; } return d; }

  function bchTypeInfo(data) {
    var d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= (G15 << (bchDigit(d) - bchDigit(G15)));
    return ((data << 10) | d) ^ G15_MASK;
  }

  function bchTypeNumber(data) {
    var d = data << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= (G18 << (bchDigit(d) - bchDigit(G18)));
    return (data << 12) | d;
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; }
  ];

  /* ======================= 5) UTF-8 ======================= */

  function toUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(str));
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  /* ======================= 6) النموذج الأساسي ======================= */

  function QRModel(version, ecLevel) {
    this.version = version;
    this.ecLevel = ecLevel;
    this.ecBits = EC_BITS[ecLevel];
    this.size = version * 4 + 17;
    this.modules = null;
    this.blocks = RS_BLOCKS[ecLevel][version - 1];
    this.dataCodewords = this.blocks.reduce(function (s, b) { return s + b[0] * b[2]; }, 0);
  }

  /* السعة المتاحة بالبت للبيانات (بايت الوضع) */
  QRModel.prototype.byteCapacity = function () {
    var countBits = this.version >= 10 ? 16 : 8;
    return Math.floor((this.dataCodewords * 8 - 4 - countBits) / 8);
  };

  /* بناء ترميز البيانات + التصحيح */
  QRModel.prototype.buildCodewords = function (bytes) {
    var buf = new BitBuffer();
    var countBits = this.version >= 10 ? 16 : 8;
    buf.put(4, 4);                 // وضع البايت (0100)
    buf.put(bytes.length, countBits);
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    var totalBits = this.dataCodewords * 8;
    // بت الإنهاء
    if (buf.length + 4 <= totalBits) buf.put(0, 4);
    // الموازنة إلى حد البايت
    while (buf.length % 8 !== 0) buf.putBit(false);
    // بايتات الحشو — تبدأ دائماً بـ 0xEC ثم 0x11 بالتبادل (حسب المعيار)
    var padIndex = 0;
    while (buf.buffer.length < this.dataCodewords) {
      buf.buffer.push(padIndex % 2 === 0 ? 0xec : 0x11);
      padIndex++;
    }
    var data = buf.buffer.slice(0, this.dataCodewords);

    // تقسيم الكتل + حساب التصحيح
    var maxData = 0, maxEc = 0, offset = 0, blocks = [];
    for (var b = 0; b < this.blocks.length; b++) {
      var cnt = this.blocks[b][0], total = this.blocks[b][1], dc = this.blocks[b][2], ec = total - dc;
      maxData = Math.max(maxData, dc); maxEc = Math.max(maxEc, ec);
      for (var k = 0; k < cnt; k++) {
        var chunk = data.slice(offset, offset + dc); offset += dc;
        blocks.push({ data: chunk, ec: rsEncode(chunk, ec) });
      }
    }

    // التشابك (Interleaving)
    var out = [];
    for (var i2 = 0; i2 < maxData; i2++) {
      for (var bi = 0; bi < blocks.length; bi++) if (i2 < blocks[bi].data.length) out.push(blocks[bi].data[i2]);
    }
    for (var i3 = 0; i3 < maxEc; i3++) {
      for (var bj = 0; bj < blocks.length; bj++) if (i3 < blocks[bj].ec.length) out.push(blocks[bj].ec[i3]);
    }
    return out;
  };

  /* رسم الأنماط الثابتة */
  QRModel.prototype.setupPatterns = function () {
    var n = this.size, mods = this.modules, i, j;
    /* رسم نمط العين (7×7) مع حلقة الفصل (separator) المحيطة به — كلها وحدات وظيفية */
    function probe(row, col) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        if (mods[rr][cc] !== null) continue;
        var inFinder = (r >= 0 && r <= 6 && c >= 0 && c <= 6);
        var dark = inFinder && (
          c === 0 || c === 6 || r === 0 || r === 6 ||   // إطار العين
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)        // مركز العين
        );
        mods[rr][cc] = dark; // حلقة الفصل = فاتحة دائماً
      }
    }
    probe(0, 0); probe(n - 7, 0); probe(0, n - 7);
    // نمط التوقيت
    for (i = 8; i < n - 8; i++) {
      if (mods[i][6] === null) mods[i][6] = i % 2 === 0;
      if (mods[6][i] === null) mods[6][i] = i % 2 === 0;
    }
    // أنماط المحاذاة — تُتجاهل فقط التي تتقاطع مع العيون الثلاث، وتُرسم فوق خط التوقيت
    var pos = ALIGN_POS[this.version - 1];
    var last = pos.length - 1;
    for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      var row = pos[i], col = pos[j];
      for (var r2 = -2; r2 <= 2; r2++) for (var c2 = -2; c2 <= 2; c2++) {
        mods[row + r2][col + c2] = (r2 === -2 || r2 === 2 || c2 === -2 || c2 === 2 ||
          (r2 === 0 && c2 === 0));
      }
    }
  };

  QRModel.prototype.setupTypeInfo = function (test, mask) {
    var bits = bchTypeInfo((this.ecBits << 3) | mask), n = this.size, i, mod;
    for (i = 0; i < 15; i++) {
      mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) this.modules[i][8] = mod;
      else if (i < 8) this.modules[i + 1][8] = mod;
      else this.modules[n - 15 + i][8] = mod;
    }
    for (i = 0; i < 15; i++) {
      mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) this.modules[8][n - i - 1] = mod;
      else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
      else this.modules[8][15 - i - 1] = mod;
    }
    this.modules[n - 8][8] = !test;
  };

  QRModel.prototype.setupTypeNumber = function (test) {
    if (this.version < 7) return;
    var bits = bchTypeNumber(this.version), n = this.size, i;
    for (i = 0; i < 18; i++) {
      var mod = !test && ((bits >> i) & 1) === 1;
      this.modules[Math.floor(i / 3)][i % 3 + n - 8 - 3] = mod;
    }
    for (i = 0; i < 18; i++) {
      var mod2 = !test && ((bits >> i) & 1) === 1;
      this.modules[i % 3 + n - 8 - 3][Math.floor(i / 3)] = mod2;
    }
  };

  QRModel.prototype.mapData = function (data, mask) {
    var n = this.size, inc = -1, row = n - 1, bitIndex = 7, byteIndex = 0, maskFn = MASKS[mask];
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            var dark = false;
            if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            if (maskFn(row, col - c)) dark = !dark;
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || n <= row) { row -= inc; inc = -inc; break; }
      }
    }
  };

  QRModel.prototype.lostPoint = function () {
    var n = this.size, mods = this.modules, lost = 0, row, col, i;
    // قاعدة 1
    for (row = 0; row < n; row++) for (col = 0; col < n; col++) {
      var same = 0, dark = mods[row][col];
      for (var r = -1; r <= 1; r++) { if (row + r < 0 || n <= row + r) continue;
        for (var c = -1; c <= 1; c++) { if (col + c < 0 || n <= col + c) continue;
          if (r === 0 && c === 0) continue;
          if (dark === mods[row + r][col + c]) same++;
        }
      }
      if (same > 5) lost += 3 + same - 5;
    }
    // قاعدة 2
    for (row = 0; row < n - 1; row++) for (col = 0; col < n - 1; col++) {
      var cnt = 0;
      if (mods[row][col]) cnt++; if (mods[row + 1][col]) cnt++;
      if (mods[row][col + 1]) cnt++; if (mods[row + 1][col + 1]) cnt++;
      if (cnt === 0 || cnt === 4) lost += 3;
    }
    // قاعدة 3
    for (row = 0; row < n; row++) for (col = 0; col < n - 6; col++) {
      if (mods[row][col] && !mods[row][col + 1] && mods[row][col + 2] && mods[row][col + 3] &&
          mods[row][col + 4] && !mods[row][col + 5] && mods[row][col + 6]) lost += 40;
    }
    for (col = 0; col < n; col++) for (row = 0; row < n - 6; row++) {
      if (mods[row][col] && !mods[row + 1][col] && mods[row + 2][col] && mods[row + 3][col] &&
          mods[row + 4][col] && !mods[row + 5][col] && mods[row + 6][col]) lost += 40;
    }
    // قاعدة 4
    var darkCount = 0;
    for (col = 0; col < n; col++) for (row = 0; row < n; row++) if (mods[row][col]) darkCount++;
    lost += Math.abs(100 * darkCount / n / n - 50) / 5 * 10;
    return lost;
  };

  QRModel.prototype.make = function (codewords) {
    var data = codewords || this._codewords;
    if (!data) throw new Error('BRCQR: لم يتم تزويد بيانات');
    var bestMask = 0, minLost = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      this.build(mask, data);
      var lost = this.lostPoint();
      if (mask === 0 || lost < minLost) { minLost = lost; bestMask = mask; }
    }
    this.maskPattern = bestMask;
    this.build(bestMask, data);
    return this;
  };

  QRModel.prototype.build = function (mask, data) {
    var n = this.size, i, j;
    this.modules = [];
    for (i = 0; i < n; i++) { this.modules.push([]); for (j = 0; j < n; j++) this.modules[i].push(null); }
    this.setupPatterns();
    this.setupTypeInfo(false, mask);
    this.setupTypeNumber(false);
    this.mapData(data, mask);
  };

  QRModel.prototype.getModuleCount = function () { return this.size; };
  QRModel.prototype.isDark = function (row, col) { return this.modules[row][col] === true; };

  /* ======================= 7) الواجهة العامة ======================= */

  /* تحويل النص إلى بايتات + اختيار النسخة المناسبة */
  function encode(text, ecLevel, forceMask) {
    ecLevel = (ecLevel || 'M').toUpperCase();
    if (!EC_BITS.hasOwnProperty(ecLevel)) ecLevel = 'M';
    var bytes = toUtf8Bytes(String(text));
    var version = -1;
    for (var v = 1; v <= 40; v++) {
      var probeModel = new QRModel(v, ecLevel);
      if (bytes.length <= probeModel.byteCapacity()) { version = v; break; }
    }
    if (version === -1) throw new Error('BRCQR: النص أطول من الحد الأقصى (' + bytes.length + ' بايت)');
    var model = new QRModel(version, ecLevel);
    var codewords = model.buildCodewords(bytes);
    model._codewords = codewords;
    if (forceMask != null) {          // فرض قناع محدد (يُستخدم في الاختبارات)
      model.maskPattern = forceMask;
      model.build(forceMask, codewords);
      return model;
    }
    return model.make(codewords);
  }

  /* --- رسم SVG --- */
  function renderSVG(model, opts) {
    opts = opts || {};
    var margin = opts.margin == null ? 2 : opts.margin;
    var dark = opts.dark || '#000000';
    var light = opts.light == null ? '#ffffff' : opts.light;
    var n = model.getModuleCount(), total = n + margin * 2;
    var path = [];
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (model.isDark(r, c)) {
          var run = 0;
          while (c + run < n && model.isDark(r, c + run)) run++;
          path.push('M' + (c + margin) + ' ' + (r + margin) + 'h' + run + 'v1h-' + run + 'z');
          c += run;
        } else c++;
      }
    }
    var sizeAttr = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '';
    var bg = light ? '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '"' + sizeAttr +
      ' shape-rendering="crispEdges">' + bg +
      '<path fill="' + dark + '" d="' + path.join('') + '"/></svg>';
  }

  /* --- رسم على Canvas --- */
  function renderCanvas(canvas, model, opts) {
    opts = opts || {};
    var size = opts.size || 300;
    var margin = opts.margin == null ? 4 : opts.margin;
    var dark = opts.dark || '#000000';
    var light = opts.light || '#ffffff';
    var n = model.getModuleCount(), total = n + margin * 2;
    var scale = size / total;
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = dark;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!model.isDark(r, c)) continue;
        ctx.fillRect(Math.floor((c + margin) * scale), Math.floor((r + margin) * scale),
          Math.ceil(scale), Math.ceil(scale));
      }
    }
    return canvas;
  }

  /* رسم بزوايا دائرية (نمط جمالي) + إمكانية إسقاط شعار في المنتصف */
  function renderCanvasStyled(canvas, model, opts) {
    opts = opts || {};
    var size = opts.size || 320;
    var margin = opts.margin == null ? 3 : opts.margin;
    var dark = opts.dark || '#0f172a';
    var light = opts.light || '#ffffff';
    var logo = opts.logo || null;
    var logoRatio = opts.logoRatio || 0.24;
    var n = model.getModuleCount(), total = n + margin * 2;
    var scale = size / total, radius = scale * 0.42;
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = light;
    roundRect(ctx, 0, 0, size, size, opts.cornerRadius == null ? size * 0.08 : opts.cornerRadius);
    ctx.fill();
    ctx.fillStyle = dark;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!model.isDark(r, c)) continue;
        // زوايا العين (finders) تبقى مربعة لوضوح المسح
        var isEye = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
        var x = (c + margin) * scale, y = (r + margin) * scale;
        if (isEye) { ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(scale), Math.ceil(scale)); }
        else {
          var pad = scale * 0.06;
          var d = scale - pad * 2;
          var rr = Math.min(radius, d / 2);
          roundRect(ctx, x + pad, y + pad, d, d, opts.dotRadius === false ? 0 : rr, true);
        }
      }
    }
    if (logo) {
      var ls = size * logoRatio;
      var lx = (size - ls) / 2, ly = (size - ls) / 2;
      ctx.save();
      ctx.fillStyle = light;
      roundRect(ctx, lx - ls * 0.06, ly - ls * 0.06, ls * 1.12, ls * 1.12, ls * 0.16);
      ctx.fill();
      ctx.restore();
      try { ctx.drawImage(logo, lx, ly, ls, ls); } catch (e) { /* تجاهل */ }
    }
    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r, fillOnly) {
    if (r <= 0) { if (fillOnly) ctx.fillRect(x, y, w, h); else ctx.rect(x, y, w, h); return; }
    r = Math.min(r, w / 2, h / 2);
    if (!fillOnly) ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    if (fillOnly) { ctx.closePath(); ctx.fill(); }
    else { ctx.closePath(); }
  }

  /* ======================= 8) الاختبارات الذاتية ======================= */

  function countDataModules(version) {
    // بناء هيكل فارغ (بدون بيانات) لحساب عدد الوحدات غير الوظيفية هندسياً
    var probe = new QRModel(version, 'L');
    probe.modules = [];
    for (var i = 0; i < probe.size; i++) { probe.modules.push([]); for (var j = 0; j < probe.size; j++) probe.modules[i].push(null); }
    probe.setupPatterns();
    probe.setupTypeInfo(true, 0);
    probe.setupTypeNumber(true);
    var count = 0;
    for (var r = 0; r < probe.size; r++) for (var c = 0; c < probe.size; c++) if (probe.modules[r][c] === null) count++;
    return count;
  }

  /* قراءة البتات من المصفوفة بنفس ترتيب mapData مع إلغاء القناع (لاختبار الذهاب والعودة) */
  function readCodewords(model) {
    var n = model.size, out = [], byte = 0, bitIndex = 7;
    var maskFn = MASKS[model.maskPattern == null ? 0 : model.maskPattern];
    var inc = -1, row = n - 1;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var rr = row, cc = col - c;
          var functional = isFunctional(model, rr, cc);
          if (!functional) {
            var v = (model.isDark(rr, cc) ? 1 : 0) ^ (maskFn(rr, cc) ? 1 : 0);
            if (v) byte |= (1 << bitIndex);
            bitIndex--;
            if (bitIndex === -1) { out.push(byte); byte = 0; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || n <= row) { row -= inc; inc = -inc; break; }
      }
    }
    return out;
  }

  function isFunctional(model, row, col) {
    var n = model.size, pos = ALIGN_POS[model.version - 1], i, j;
    if (row === 6 || col === 6) return true;
    if (row < 9 && col < 9) return true;
    if (row < 9 && col >= n - 8) return true;
    if (row >= n - 8 && col < 9) return true;
    if (model.version >= 7 && ((row < 6 && col >= n - 11 && col < n - 8) || (col < 6 && row >= n - 11 && row < n - 8))) return true;
    var last = pos.length - 1;
    for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
      // الأنماط المتقاطعة مع العيون لا وجود لها فعلياً
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      if (Math.abs(pos[i] - row) <= 2 && Math.abs(pos[j] - col) <= 2) return true;
    }
    return false;
  }

  function selfTest(verbose) {
    var results = [];
    function check(name, fn) {
      try { var ok = fn(); results.push({ name: name, pass: ok === true, detail: ok === true ? '' : String(ok) }); }
      catch (e) { results.push({ name: name, pass: false, detail: e.message }); }
    }

    // 1) تطابق كتل RS مع العدد الهندسي للوحدات
    check('تطابق جدول كتل التصحيح مع عدد وحدات المصفوفة (1..40)', function () {
      for (var v = 1; v <= 40; v++) {
        var geometric = countDataModules(v);
        ['L', 'M', 'Q', 'H'].forEach(function (lv) {
          var m = new QRModel(v, lv);
          var bits = m.blocks.reduce(function (s, b) { return s + b[0] * b[1]; }, 0) * 8 + REMAINDER_BITS[v - 1];
          if (bits !== geometric) throw new Error('نسخة ' + v + ' مستوى ' + lv + ': ' + bits + ' != ' + geometric);
        });
      }
      return true;
    });

    // 2) معلومات التنسيق: مطابقة القيم القياسية للمعيار + أصفار القسمة (syndrome)
    check('ترميز معلومات التنسيق (32 حالة) ومطابقة القيم القياسية', function () {
      // القيم القياسية المعروفة لمستوى تصحيح ثابت (قناع 0)
      var canonical = { L: 0x77c4, M: 0x5412, Q: 0x355f, H: 0x1689 };
      for (var lv in EC_BITS) {
        var base = bchTypeInfo(EC_BITS[lv] << 3);
        if (base !== canonical[lv]) throw new Error('قيمة قياسية خاطئة للمستوى ' + lv + ' (متوقع ' + canonical[lv].toString(16) + ' وحصلنا ' + base.toString(16) + ')');
        for (var mask = 0; mask < 8; mask++) {
          var bits = bchTypeInfo((EC_BITS[lv] << 3) | mask);
          var unmasked = bits ^ G15_MASK;
          if (((unmasked >> 13) & 3) !== EC_BITS[lv]) throw new Error('فشل استرجاع مستوى التصحيح ' + lv + '/' + mask);
          if (((unmasked >> 10) & 7) !== mask) throw new Error('فشل استرجاع القناع ' + lv + '/' + mask);
          // التحقق أنها كلمة كود صحيحة: الباقي عند القسمة على G15 يساوي صفراً
          var d = unmasked;
          while (bchDigit(d) - bchDigit(G15) >= 0) d ^= (G15 << (bchDigit(d) - bchDigit(G15)));
          if (d !== 0) throw new Error('كلمة تنسيق غير صحيحة ' + lv + '/' + mask);
        }
      }
      return true;
    });

    // 3) أرقام النسخ (7..40)
    check('ترميز معلومات رقم النسخة (7..40)', function () {
      for (var v = 7; v <= 40; v++) {
        var bits = bchTypeNumber(v);
        if (((bits >> 12) & 0x3f) !== v) throw new Error('فشل النسخة ' + v);
      }
      return true;
    });

    // 4) الذهاب والعودة: كتابة البيانات ثم قراءتها + التحقق من بايتات التصحيح
    check('ذهاب وعودة للبيانات وفحص بايتات التصحيح', function () {
      var words = ['BRC-000120', 'https://brc-babil.com/verify?form=BRC-000120&t=ab12', 'شركة الهدف للتوظيف'];
      words.forEach(function (w) {
        ['L', 'M', 'Q', 'H'].forEach(function (lv) {
          var model = encode(w, lv);
          var read = readCodewords(model);
          var totalCodewords = model.blocks.reduce(function (s, b) { return s + b[0] * b[1]; }, 0);
          if (read.length !== totalCodewords) throw new Error('عدد البايتات المقروءة غير مطابق (' + read.length + ' != ' + totalCodewords + ')');
          // التحقق من بايتات التصحيح لكل كتلة
          var offset = 0, blocks = [];
          model.blocks.forEach(function (b) { for (var k = 0; k < b[0]; k++) { blocks.push({ total: b[1], data: b[2] }); } });
          var maxData = 0, maxEc = 0;
          blocks.forEach(function (b) { maxData = Math.max(maxData, b.data); maxEc = Math.max(maxEc, b.total - b.data); });
          var dataArr = {}, ecArr = {};
          blocks.forEach(function (b, i) { dataArr[i] = []; ecArr[i] = []; });
          var dataBytes = read.slice(0, model.dataCodewords);
          var ecBytes = read.slice(model.dataCodewords);
          var di = 0, ei = 0;
          for (var i2 = 0; i2 < maxData; i2++) for (var bi = 0; bi < blocks.length; bi++) if (i2 < blocks[bi].data) dataArr[bi].push(dataBytes[di++]);
          for (var i3 = 0; i3 < maxEc; i3++) for (var bj = 0; bj < blocks.length; bj++) if (i3 < blocks[bj].total - blocks[bj].data) ecArr[bj].push(ecBytes[ei++]);
          offset = 0;
          for (var b2 = 0; b2 < blocks.length; b2++) {
            var full = dataArr[b2].concat(ecArr[b2]);
            var remainder = polyRemainder(full, blocks[b2].total - blocks[b2].data);
            if (remainder.some(function (x) { return x !== 0; })) throw new Error('بايتات تصحيح خاطئة في كتلة ' + b2 + ' للنص ' + w);
          }
        });
      });
      return true;
    });

    // 5) أحجام المصفوفة وحدود السعة
    check('أحجام المصفوفة وحساب السعة', function () {
      for (var v = 1; v <= 40; v++) {
        var size = v * 4 + 17;
        if (new QRModel(v, 'L').getModuleCount() !== size) throw new Error('حجم خاطئ للنسخة ' + v);
        var l = new QRModel(v, 'L').byteCapacity();
        var h = new QRModel(v, 'H').byteCapacity();
        if (!(l > 0 && h > 0 && l > h)) throw new Error('سعة غير منطقية للنسخة ' + v);
        if (v > 1 && !(l > new QRModel(v - 1, 'L').byteCapacity())) throw new Error('السعة لا تزيد مع النسخة ' + v);
      }
      // حد السعة لنسخة 40 بمستوى L
      if (new QRModel(40, 'L').byteCapacity() !== 2953) throw new Error('سعة النسخة 40 خاطئة');
      return true;
    });

    // 6) الأنماط الثابتة: العين و التوقيت
    check('سلامة الأنماط الثابتة (العيون والتوقيت)', function () {
      var model = encode('test', 'M');
      var n = model.getModuleCount();
      for (var i = 0; i < 7; i++) {
        if (!model.isDark(0, i) || !model.isDark(6, i) || !model.isDark(i, 0) || !model.isDark(i, 6)) throw new Error('عين غير سليمة');
        if (model.isDark(1, 1)) throw new Error('منتصف العين يجب أن يكون فاتحاً');
      }
      for (var k = 8; k < n - 8; k++) {
        if (model.isDark(k, 6) !== (k % 2 === 0)) throw new Error('نمط التوقيت العمودي خاطئ');
        if (model.isDark(6, k) !== (k % 2 === 0)) throw new Error('نمط التوقيت الأفقي خاطئ');
      }
      return true;
    });

    var passed = results.filter(function (r) { return r.pass; }).length;
    var report = { passed: passed, failed: results.length - passed, total: results.length, results: results };
    if (verbose) report.results.forEach(function (r) { console.log((r.pass ? 'PASS' : 'FAIL') + ' — ' + r.name + (r.detail ? ' :: ' + r.detail : '')); });
    return report;
  }

  /* قسمة كثيرة الحدود (للفحص) */
  function polyRemainder(bytes, ecCount) {
    var gen = rsGenerator(ecCount);
    var res = new Array(ecCount).fill(0);
    for (var i = 0; i < bytes.length; i++) {
      var factor = bytes[i] ^ res[0];
      res.shift(); res.push(0);
      for (var j = 0; j < ecCount; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
  }

  return {
    encode: encode,
    model: QRModel,
    renderSVG: renderSVG,
    renderCanvas: renderCanvas,
    renderCanvasStyled: renderCanvasStyled,
    selfTest: selfTest,
    toUtf8Bytes: toUtf8Bytes,
    _internals: { rsEncode: rsEncode, bchTypeInfo: bchTypeInfo, bchTypeNumber: bchTypeNumber, readCodewords: readCodewords, isFunctional: isFunctional, RS_BLOCKS: RS_BLOCKS, REMAINDER_BITS: REMAINDER_BITS }
  };
});
