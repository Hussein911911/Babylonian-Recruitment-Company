import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = p => readFileSync(p, 'utf8');
const ar = 'منصة مكسب للتوظيف';
const en = 'Makseb Employment Platform';
for (const file of ['index.html', 'verify.html', 'dashboard.html', '404.html', 'hrc-light.html', 'hrc-standalone.html']) {
  const html = read(file);
  assert.match(html, /<title>[^<]*منصة مكسب للتوظيف/);
  assert.match(html, /<meta name="author" content="Makseb Employment Platform">/);
}
for (const file of ['src/partials/public.html', 'src/partials/footer.html', 'src/partials/verify.html', 'src/partials/dashboard.html', 'assets/js/public.js', 'supabase-check.html', 'form-design.html', 'card-design.html']) {
  assert.doesNotMatch(read(file), /شركة الهدف|Al-Hadaf/i, file);
}
// Check visible HTML on all main and auxiliary public pages, including the
// separate local office app. Scripts/styles are excluded: legal data and
// historical code comments are not display branding.
const htmlFiles = [...readdirSync('.').filter(f => f.endsWith('.html')),
  ...readdirSync('src/partials').filter(f => f.endsWith('.html')).map(f => `src/partials/${f}`),
  ...readdirSync('docs/preview').filter(f => f.endsWith('.html')).map(f => `docs/preview/${f}`),
  'office/public/index.html'];
for (const file of htmlFiles) {
  const html = read(file).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(html, /شركة الهدف|Al-Hadaf/i, `${file}: old display name`);
}
assert.ok(read('office/public/index.html').includes(ar));
const config = read('assets/js/config.js');
assert.ok(config.includes(`nameAr: '${ar}'`));
assert.ok(config.includes(`nameEn: '${en}'`));
const voucher = read('assets/js/voucher.js');
assert.ok(voucher.includes('CFG.company.nameAr') && voucher.includes('CFG.company.nameEn'));
assert.ok(read('form-design.html').includes(ar) && read('form-design.html').includes(en));
assert.match(read('assets/js/public.js'), /بطاقة توظيف منصة مكسب/);
assert.match(read('assets/js/public.js'), /مرحباً منصة مكسب للتوظيف/);
const migration = read('supabase/migrations/20261101170000_makseb_display_name.sql');
assert.ok(migration.includes(ar) && migration.includes(en));
assert.doesNotMatch(migration, /\{legalName\}/);
console.log('PASS Makseb display names, metadata, notifications, forms, and migration.');
