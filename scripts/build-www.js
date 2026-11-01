// Copia i file dell'app in www/ (la cartella che Capacitor impacchetta nell'APK).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
const keep = /\.(html|css|js|svg|png|webmanifest)$/;
const skip = new Set(['capacitor.config.json', 'package.json']);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of fs.readdirSync(root)) {
  if (fs.statSync(path.join(root, f)).isFile() && keep.test(f) && !skip.has(f)) fs.copyFileSync(path.join(root, f), path.join(out, f));
}
console.log('www/ pronta:', fs.readdirSync(out).length, 'file');
