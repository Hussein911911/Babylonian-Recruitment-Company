import { readFileSync } from 'node:fs';
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
