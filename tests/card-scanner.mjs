import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import qrcode from 'qrcode-generator';

// Exercise the real decoder against QR pixels, without relying on BarcodeDetector.
const value = 'https://example.com/apply.html?form=9TRX2KQ4M7';
const qr = qrcode(0, 'M'); qr.addData(value); qr.make();
const modules = qr.getModuleCount(), scale = 6, margin = 4;
const size = (modules + margin * 2) * scale;
const pixels = new Uint8ClampedArray(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const r = Math.floor(y / scale) - margin, c = Math.floor(x / scale) - margin;
  const dark = r >= 0 && c >= 0 && r < modules && c < modules && qr.isDark(r, c);
  const i = (y * size + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = dark ? 0 : 255; pixels[i + 3] = 255;
}
const scannerSource = readFileSync('assets/js/qr-scan.js', 'utf8');
const librarySource = readFileSync('assets/vendor/jsqr.js', 'utf8');
function setup(detector) {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', url: 'https://example.com/' });
  const w = dom.window;
  if (detector) w.BarcodeDetector = detector;
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: pixels, width: size, height: size }) });
  w.eval(librarySource); w.eval(scannerSource);
  return dom;
}
for (const Detector of [null, class { static getSupportedFormats() { return ['qr_code']; } detect() { return Promise.resolve([]); } }, class { static getSupportedFormats() { throw Error('broken'); } detect() { throw Error('broken'); } }]) {
  const dom = setup(Detector), scan = dom.window.HRCQRScan;
  assert.equal(scan.supported(), true);
  const frame = { videoWidth: size, videoHeight: size };
  assert.equal((await scan.detectVideoFrame(frame))[0], value);
  assert.equal(scan.serialFrom((await scan.detectImage({ width: size, height: size }))[0]), '9TRX2KQ4M7');
  dom.window.close();
}
{
  const dom = setup(null), w = dom.window;
  let revoked = false;
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => { revoked = true; };
  w.Image = class { constructor() { this.naturalWidth = this.naturalHeight = size; } set src(v) { queueMicrotask(() => this.onload()); } };
  assert.equal((await w.HRCQRScan.detectImage(new w.Blob(['photo'], { type: 'image/png' })))[0], value);
  assert.equal(revoked, true);
  dom.window.close();
}
console.log('Card scanner: real QR decoding works without native API, with failing/empty native detection, and with uploaded files.');
