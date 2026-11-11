import fs from 'node:fs';
const p = 'D:/Code/dsh-remote/.testhome/profiles/remote-dev/package.json';
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
data.dsh = data.dsh || {};
data.dsh.profile = data.dsh.profile || {};
data.dsh.profile.bundles = data.dsh.profile.bundles || [];
if (!data.dsh.profile.bundles.includes('dsh-remote-harness')) data.dsh.profile.bundles.push('dsh-remote-harness');
fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
console.log('bundles', JSON.stringify(data.dsh.profile.bundles));
