import fs from 'node:fs';
const p = 'D:/Code/dsh-remote/.testhome/profiles/remote-dev/cordis.patch.yml';
let text = fs.readFileSync(p, 'utf8');
const marker = '# test override for the bundle-installed plugin';
if (!text.includes(marker)) {
  text += '\n' + marker + '\n- id: dsh-remote\n  config:\n    port: 8791\n    publicUrl: "https://dsh-remote-test.example.com"\n';
  fs.writeFileSync(p, text);
}
console.log('patch has override:', text.includes(marker));
