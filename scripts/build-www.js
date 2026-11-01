// Copia i file dell'app in www/ (la cartella che Capacitor impacchetta nell'APK).
// Include anche vendor/ (le librerie per PDF, Word ed Excel) con tutte le sottocartelle.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
const keep = /\.(html|css|js|svg|png|webmanifest)$/;
const skip = new Set(['capacitor.config.json', 'package.json']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) n += copyDir(a, b);
    else { fs.copyFileSync(a, b); n++; }
  }
  return n;
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
let count = 0;
for (const f of fs.readdirSync(root)) {
  if (fs.statSync(path.join(root, f)).isFile() && keep.test(f) && !skip.has(f)) { fs.copyFileSync(path.join(root, f), path.join(out, f)); count++; }
}
if (fs.existsSync(path.join(root, 'vendor'))) count += copyDir(path.join(root, 'vendor'), path.join(out, 'vendor'));
else console.warn('Attenzione: cartella vendor/ non trovata, PDF/Word/Excel non funzioneranno.');
console.log('www/ pronta:', count, 'file');
