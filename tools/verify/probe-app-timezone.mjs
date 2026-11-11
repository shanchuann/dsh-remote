const mod = await import('../../app/src/lib/timezone.ts');
const fn = mod.normalizeClientTimeZone;
const cases = [
  ['GMT', 'UTC'], ['UTC', 'UTC'], ['Etc/UTC', 'UTC'], ['Etc/GMT', 'UTC'], ['Etc/GMT+0', 'UTC'], ['Etc/GMT-0', 'UTC'],
  ['  gmt  ', 'UTC'], ['Asia/Shanghai', 'Asia/Shanghai'], ['America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
  ['Etc/GMT-8', 'Etc/GMT-8'], ['CST', undefined], ['GMT+8', undefined], ['+08:00', undefined], ['', undefined], [null, undefined], [undefined, undefined],
];
let pass = 0; const fails = [];
for (const [input, expected] of cases) {
  let actual;
  try { actual = fn(input); } catch (e) { actual = 'THREW:' + e.message; }
  if (actual === expected) pass += 1; else fails.push({ input, expected, actual });
}
console.log(JSON.stringify({ pass, total: cases.length, fails }, null, 2));
