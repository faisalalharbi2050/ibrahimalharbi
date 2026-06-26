const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
const adminOut = path.join(root, 'dist-admin');
const publicFiles = ['index.html', 'privacy.html', 'terms.html'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of publicFiles) {
  const source = path.join(root, 'site', file);
  if (!fs.existsSync(source)) throw new Error(`Missing production asset: ${file}`);
  fs.copyFileSync(source, path.join(out, file));
}

fs.copyFileSync(path.join(root, 'site', 'vercel.json'), path.join(out, 'vercel.json'));

fs.rmSync(adminOut, { recursive: true, force: true });
fs.mkdirSync(adminOut, { recursive: true });
fs.copyFileSync(path.join(root, 'admin/index.html'), path.join(adminOut, 'index.html'));
fs.copyFileSync(path.join(root, 'admin/vercel.json'), path.join(adminOut, 'vercel.json'));

console.log(`Built public site in dist/ and admin portal in dist-admin/`);
