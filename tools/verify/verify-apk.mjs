#!/usr/bin/env node
/**
 * Verify the built Android APK for DSH Remote (task 4: app build verification).
 *
 * Checks:
 *   - APK exists, size, SHA-256
 *   - package name (default dev.dsh.remote) via aapt2 dump badging
 *   - launchable activity (MainActivity) and launch intent
 *   - required archive entries (AndroidManifest.xml, resources.arsc, classes*.dex)
 *   - launcher icon resources present for every density (mipmap-*)
 *   - foreground vs monochrome icon hashes (themed icon sanity)
 *   - extracts icon files for visual inspection (tools/verify/.apk-icons/)
 *
 * Usage:
 *   node tools/verify/verify-apk.mjs
 *   node tools/verify/verify-apk.mjs --apk app/android/app/build/outputs/apk/debug/app-debug.apk
 *   node tools/verify/verify-apk.mjs --report docs/verification/app-build-report.md
 *
 * Requires no npm deps. Uses aapt2 from D:\Android\Sdk\build-tools\* or --aapt2.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const BT = String.fromCharCode(96);
const RESULTS = [];

function check(name, fn, opts = {}) {
  try {
    const detail = fn();
    RESULTS.push({ name, status: 'pass', detail });
    console.log('PASS ' + name + (detail ? ' :: ' + JSON.stringify(detail).slice(0, 300) : ''));
  } catch (e) {
    const status = opts.severity === 'warn' ? 'warn' : 'fail';
    RESULTS.push({ name, status, error: e && e.message ? e.message : String(e) });
    console.log((status === 'fail' ? 'FAIL ' : 'WARN ') + name + ' :: ' + (e && e.message ? e.message : e));
  }
}
function require_(cond, message) { if (!cond) throw new Error(message); }

function findDefaultApk() {
  const base = resolve('app/android/app/build/outputs/apk');
  if (!existsSync(base)) return null;
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.apk')) found.push({ path: p, mtime: st.mtimeMs, size: st.size });
    }
  };
  walk(base);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] ? found[0].path : null;
}

function findBuildTool(fileName) {
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, 'D:\\Android\\Sdk'].filter(Boolean);
  const candidates = [];
  for (const root of sdkRoots) {
    const bt = join(root, 'build-tools');
    if (!existsSync(bt)) continue;
    for (const ver of readdirSync(bt)) candidates.push({ ver, path: join(bt, ver, fileName) });
  }
  candidates.sort((a, b) => a.ver.localeCompare(b.ver, undefined, { numeric: true }));
  for (const c of candidates.reverse()) if (existsSync(c.path)) return c.path;
  return null;
}

function findAapt2(explicit) {
  if (explicit) return explicit;
  return findBuildTool('aapt2.exe');
}

function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

function tarList(apk) {
  const r = spawnSync('tar', ['-tf', apk], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('tar -tf failed: ' + (r.stderr || '').slice(0, 500));
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

function tarExtract(apk, outDir) {
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync('tar', ['-xf', apk, '-C', outDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('tar -xf failed: ' + (r.stderr || '').slice(0, 500));
}

function main() {
  const { values: args } = parseArgs({
    options: {
      apk: { type: 'string' },
      aapt2: { type: 'string' },
      'json-out': { type: 'string', default: 'tools/verify/.app-build-report.json' },
      report: { type: 'string', default: 'docs/verification/app-build-report.md' },
      'expected-package': { type: 'string', default: 'dev.dsh.remote' },
      'extract-dir': { type: 'string', default: 'tools/verify/.apk-extract' },
      'icons-dir': { type: 'string', default: 'tools/verify/.apk-icons' },
      'skip-prebuilt-check': { type: 'boolean', default: false },
      'expected-bundle-bytes': { type: 'string' },
    },
    allowPositionals: false,
  });
  const startedAt = new Date();
  const apkPath = args.apk ? resolve(args.apk) : findDefaultApk();
  const aapt2 = findAapt2(args.aapt2);
  const extractDir = resolve(args['extract-dir']);
  const iconsDir = resolve(args['icons-dir']);
  const info = { apkPath, variant: null, sizeBytes: 0, sha256: null, packageName: null, versionName: null, versionCode: null, launchableActivity: null, sdkVersion: null, targetSdkVersion: null, nativeCode: [], abis: [], cleartextTraffic: null, hasJsBundle: null, signer: null, iconHashes: {}, entries: {}, iconsExtracted: [] };

  check('apk.exists', () => {
    require_(apkPath, 'no APK found under app/android/app/build/outputs/apk (build first: cd app/android && gradlew.bat assembleDebug)');
    require_(existsSync(apkPath), 'APK path does not exist: ' + apkPath);
    info.apkPath = apkPath;
    info.variant = /release/i.test(apkPath) ? 'release' : /debug/i.test(apkPath) ? 'debug' : 'unknown';
    return { path: apkPath, file: basename(apkPath), variant: info.variant };
  });

  check('apk.size', () => {
    const st = statSync(apkPath);
    info.sizeBytes = st.size;
    require_(st.size > 5 * 1024 * 1024, 'APK smaller than 5MB (' + st.size + ' bytes), suspicious for RN debug APK');
    return { bytes: st.size, mb: +(st.size / 1024 / 1024).toFixed(2) };
  });

  check('apk.sha256', () => {
    info.sha256 = sha256(apkPath);
    return { sha256: info.sha256 };
  });

  check('apk.aapt2-available', () => {
    require_(aapt2, 'aapt2 not found (set ANDROID_HOME or pass --aapt2 D:\\Android\\Sdk\\build-tools\\36.0.0\\aapt2.exe)');
    return { aapt2 };
  }, { severity: 'warn' });

  check('apk.badging', () => {
    require_(aapt2, 'aapt2 missing');
    const out = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const pkg = /^package: name='([^']+)' versionCode='([^']*)' versionName='([^']*)'/.exec(out);
    require_(pkg, 'cannot parse package line from aapt2 badging');
    info.packageName = pkg[1];
    info.versionCode = pkg[2];
    info.versionName = pkg[3];
    const launch = /launchable-activity: name='([^']+)'/.exec(out);
    info.launchableActivity = launch ? launch[1] : null;
    const sdk = /minSdkVersion:'([^']+)'/.exec(out) || /sdkVersion:'([^']+)'/.exec(out);
    info.sdkVersion = sdk ? sdk[1] : null;
    const target = /targetSdkVersion:'([^']+)'/.exec(out);
    info.targetSdkVersion = target ? target[1] : null;
    const native = [...out.matchAll(/^native-code: (.+)$/gm)].map((m) => m[1].replace(/'/g, '')).join(' ');
    info.nativeCode = native ? native.split(/\s+/).filter(Boolean) : [];
    const label = /application-label:'([^']*)'/.exec(out);
    const appIcon = /^application: label='[^']*' icon='([^']+)'/m.exec(out);
    info.applicationLabel = label ? label[1] : null;
    info.applicationIcon = appIcon ? appIcon[1] : null;
    return { packageName: info.packageName, versionName: info.versionName, launchableActivity: info.launchableActivity, sdkVersion: info.sdkVersion, targetSdkVersion: info.targetSdkVersion, nativeCode: info.nativeCode };
  });

  check('apk.package-name', () => {
    require_(info.packageName === args['expected-package'], 'package name is ' + info.packageName + ', expected ' + args['expected-package']);
    return { packageName: info.packageName };
  });

  check('apk.launcher-activity', () => {
    require_(info.launchableActivity, 'no launchable-activity in badging');
    require_(/MainActivity$/.test(info.launchableActivity), 'launchable activity does not end with MainActivity: ' + info.launchableActivity);
    return { launchableActivity: info.launchableActivity };
  });

  let entries = [];
  check('apk.contents', () => {
    entries = tarList(apkPath);
    const has = (pred) => entries.some(pred);
    require_(has((e) => e === 'AndroidManifest.xml'), 'AndroidManifest.xml missing from APK');
    require_(has((e) => e === 'resources.arsc'), 'resources.arsc missing from APK');
    require_(has((e) => /^classes\d*\.dex$/.test(e)), 'classes*.dex missing from APK');
    const dex = entries.filter((e) => /^classes\d*\.dex$/.test(e));
    info.entries = { total: entries.length, dex };
    return { totalEntries: entries.length, dex };
  });

  check('apk.js-bundle', () => {
    const bundle = entries.find((e) => e === 'assets/index.android.bundle');
    info.hasJsBundle = Boolean(bundle);
    if (info.variant === 'release') require_(bundle, 'release APK is missing assets/index.android.bundle (JS bundle)');
    if (info.variant !== 'release' && !bundle) return { present: false, note: 'debug APK loads JS from Metro; not bundled' };
    return { present: true };
  }, { severity: 'warn' });

  check('apk.native-abis', () => {
    const abis = [...new Set(entries.map((e) => {
      const m = /^lib\/([^/]+)\//.exec(e);
      return m ? m[1] : null;
    }).filter(Boolean))];
    info.abis = abis;
    require_(abis.length > 0, 'no native libs (lib/<abi>/) in APK; is this a valid RN APK?');
    if (!abis.includes('arm64-v8a')) throw new Error('arm64-v8a missing; physical Android phones cannot install. ABIs: ' + abis.join(', '));
    return { abis };
  });

  check('apk.manifest-cleartext', () => {
    require_(aapt2, 'aapt2 missing');
    const out = execFileSync(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apkPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const enabled = /usesCleartextTraffic[^\n]*(?:0xffffffff|=true|\btrue\b)/.test(out);
    info.cleartextTraffic = enabled;
    require_(enabled, 'AndroidManifest does not set android:usesCleartextTraffic="true"; plaintext LAN HTTP will fail on Android 9+');
    return { usesCleartextTraffic: true };
  });

  check('apk.signature', () => {
    const apksigner = findBuildTool('apksigner.bat');
    if (!apksigner) return { note: 'apksigner not found; skipped' };
    const r = spawnSync(apksigner, ['verify', '--print-certs', apkPath], { encoding: 'utf8', shell: true, maxBuffer: 16 * 1024 * 1024 });
    require_(r.status === 0, 'apksigner verify failed (status ' + r.status + '): ' + String((r.stdout || '') + (r.stderr || '')).slice(0, 600));
    const subject = /Signer #1 certificate DN: ([^\r\n]+)/.exec(String(r.stdout));
    info.signer = subject ? subject[1].trim() : 'unknown';
    return { apksigner, signer: info.signer, debugCert: /Android Debug/i.test(info.signer) };
  }, { severity: 'warn' });

  check('apk.extract', () => {
    tarExtract(apkPath, extractDir);
    return { extractDir };
  });

  let iconMap = {};
  function parseIconResources(text) {
    const map = {};
    let current = null;
    for (const line of String(text).split(/\r?\n/)) {
      const head = /^\s+resource (0x[0-9a-f]+) mipmap\/(ic_launcher(?:_foreground|_monochrome|_round)?)\s*$/.exec(line);
      if (head) {
        current = head[2];
        map[current] = map[current] || {};
        map[current].__id = head[1];
        continue;
      }
      if (/^\s+resource /.test(line)) { current = null; continue; }
      const value = /^\s+\(([a-z0-9-]+)\) \(file\) (res\/\S+)/.exec(line);
      if (current !== null && value) map[current][value[1]] = value[2];
    }
    return map;
  }

  check('apk.js-bundle-size', () => {
    const bundlePath = join(extractDir, 'assets', 'index.android.bundle');
    if (!existsSync(bundlePath)) return { note: 'no bundle in APK (debug/Metro build)' };
    const bytes = statSync(bundlePath).size;
    info.jsBundle = { path: 'assets/index.android.bundle', bytes, sha256: sha256(bundlePath) };
    const expected = args['expected-bundle-bytes'] ? Number(args['expected-bundle-bytes']) : null;
    if (expected !== null) {
      require_(bytes === expected, 'JS bundle size ' + bytes + ' bytes != expected ' + expected + ' bytes');
    }
    return { bytes, sha256: info.jsBundle.sha256, expected };
  });

  check('app.icon.resources', () => {
    require_(aapt2, 'aapt2 missing');
    const text = execFileSync(aapt2, ['dump', 'resources', apkPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    iconMap = parseIconResources(text);
    const required = ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground', 'ic_launcher_monochrome'];
    const missing = required.filter((name) => !iconMap[name]);
    require_(missing.length === 0, 'missing mipmap resources in resources.arsc: ' + missing.join(', '));
    info.iconResources = iconMap;
    info.entries.mipmaps = Object.values(iconMap).reduce((n, byDensity) => n + Object.keys(byDensity).length, 0);
    return {
      names: Object.keys(iconMap),
      densities: Object.fromEntries(Object.entries(iconMap).map(([name, byDensity]) => [name, Object.keys(byDensity)])),
    };
  });

  check('app.icon.densities', () => {
    const expected = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
    const missing = [];
    for (const name of Object.keys(iconMap)) {
      for (const density of expected) if (!iconMap[name][density]) missing.push(name + '/' + density);
    }
    require_(missing.length === 0, 'missing launcher icon densities: ' + missing.join(', '));
    return { densities: expected };
  });

  check('app.icon.adaptive-xml', () => {
    const adaptive = iconMap.ic_launcher && iconMap.ic_launcher['anydpi-v26'];
    require_(adaptive, 'no anydpi-v26 adaptive icon xml for mipmap/ic_launcher');
    const tree = execFileSync(aapt2, ['dump', 'xmltree', '--file', adaptive, apkPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const fgId = iconMap.ic_launcher_foreground && iconMap.ic_launcher_foreground.__id;
    const monoId = iconMap.ic_launcher_monochrome && iconMap.ic_launcher_monochrome.__id;
    const references = (name, id) => (id && tree.includes('@' + id)) || tree.includes(name);
    require_(references('ic_launcher_foreground', fgId), 'adaptive icon does not reference ic_launcher_foreground (' + fgId + ')');
    require_(references('ic_launcher_monochrome', monoId), 'adaptive icon does not reference ic_launcher_monochrome (' + monoId + ')');
    return { file: adaptive, foregroundRef: fgId, monochromeRef: monoId };
  }, { severity: 'warn' });

  function iconFile(name, density) {
    const byDensity = iconMap[name];
    if (!byDensity) return null;
    const rel = byDensity[density] || byDensity.xxxhdpi;
    return rel ? join(extractDir, rel) : null;
  }

  check('app.icon.deepseek-foreground', () => {
    mkdirSync(iconsDir, { recursive: true });
    const fg = iconFile('ic_launcher_foreground', 'xxxhdpi');
    const mono = iconFile('ic_launcher_monochrome', 'xxxhdpi');
    const round = iconFile('ic_launcher_round', 'xxxhdpi');
    const launcher = iconFile('ic_launcher', 'xxxhdpi');
    require_(fg && existsSync(fg), 'foreground icon file not found via resources.arsc');
    const fgHash = sha256(fg);
    info.iconHashes.foreground = fgHash;
    if (round && existsSync(round)) info.iconHashes.launcher = sha256(round);
    if (mono && existsSync(mono)) {
      const monoHash = sha256(mono);
      info.iconHashes.monochrome = monoHash;
      if (monoHash === fgHash) info.iconHashes.foregroundEqualsMonochrome = true;
    }
    const copies = [];
    for (const [name, src] of [
      ['foreground-xxxhdpi.webp', fg],
      ['monochrome-xxxhdpi.webp', mono],
      ['round-xxxhdpi.webp', round],
      ['launcher-xxxhdpi.webp', launcher],
    ]) {
      if (!src || !existsSync(src)) continue;
      const dst = join(iconsDir, name);
      copyFileSync(src, dst);
      copies.push({ file: dst, source: src, hash: sha256(src) });
    }
    info.iconsExtracted = copies.map((c) => c.file);
    info.iconFiles = copies;
    return { foregroundHash: fgHash, monochromeHash: info.iconHashes.monochrome || null, foregroundEqualsMonochrome: !!info.iconHashes.foregroundEqualsMonochrome, extractedTo: iconsDir, files: copies };
  }, { severity: 'warn' });

  check('app.icon.monochrome-alpha-mask', () => {
    require_(iconMap.ic_launcher_monochrome, 'mipmap/ic_launcher_monochrome missing from resources.arsc');
    return { monochromeHash: info.iconHashes.monochrome || null, identicalToForeground: !!info.iconHashes.foregroundEqualsMonochrome, note: 'themed icon uses alpha mask; identical fg/mono accepted per Lead' };
  });

  const finishedAt = new Date();
  const counts = { pass: 0, fail: 0, warn: 0 };
  for (const r of RESULTS) counts[r.status] += 1;
  const report = {
    tool: 'verify-apk.mjs', startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    aapt2, apk: info, counts, ok: counts.fail === 0, results: RESULTS,
  };
  const jsonPath = resolve(args['json-out']);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const reportPath = resolve(args.report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderMarkdown(report));
  console.log('\n' + JSON.stringify(counts) + ' -> ' + jsonPath + ', ' + reportPath);
  if (!report.ok) process.exitCode = 1;
}

function renderMarkdown(report) {
  const L = [];
  L.push('# DSH Remote Android APK 构建验证报告');
  L.push('');
  L.push('- 生成时间：' + report.finishedAt);
  L.push('- APK：' + BT + (report.apk.apkPath || '(not found)') + BT);
  L.push('- 大小：' + (report.apk.sizeBytes / 1024 / 1024).toFixed(2) + ' MB，SHA-256：' + BT + (report.apk.sha256 || '-') + BT);
  L.push('- 包名：' + BT + (report.apk.packageName || '-') + BT + '，版本：' + (report.apk.versionName || '-') + '（code ' + (report.apk.versionCode || '-') + '）');
  L.push('- 启动 Activity：' + BT + (report.apk.launchableActivity || '-') + BT);
  L.push('- 变体：' + (report.apk.variant || '-') + '，JS bundle：' + (report.apk.hasJsBundle ? 'assets/index.android.bundle ✅' + (report.apk.jsBundle && report.apk.jsBundle.bytes ? '（' + report.apk.jsBundle.bytes + ' bytes，sha256 ' + String(report.apk.jsBundle.sha256).slice(0, 16) + '…）' : '') : '无（debug 由 Metro 提供）'));
  L.push('- 明文 HTTP：android:usesCleartextTraffic = ' + (report.apk.cleartextTraffic === true ? 'true ✅' : String(report.apk.cleartextTraffic)));
  L.push('- ABIs：' + ((report.apk.abis || []).join(', ') || '-') + '；签名证书：' + (report.apk.signer || '-'));
  L.push('- minSdk/targetSdk：' + (report.apk.sdkVersion || '-') + ' / ' + (report.apk.targetSdkVersion || '-') + '，badging native-code：' + (report.apk.nativeCode.join(', ') || '-'));
  L.push('- 结果：**' + (report.ok ? 'PASS' : 'FAIL') + '** — pass ' + report.counts.pass + ' / fail ' + report.counts.fail + ' / warn ' + report.counts.warn);
  L.push('');
  L.push('## 检查项');
  L.push('');
  L.push('| # | 检查 | 结果 | 说明 |');
  L.push('|---|---|---|---|');
  report.results.forEach((r, i) => {
    const detail = r.status === 'pass' ? JSON.stringify(r.detail) : (r.error || '');
    L.push('| ' + (i + 1) + ' | ' + BT + r.name + BT + ' | ' + (r.status === 'pass' ? '✅ PASS' : r.status === 'warn' ? '⚠️ WARN' : '❌ FAIL') + ' | ' + String(detail).replace(/\|/g, '\\|').slice(0, 240) + ' |');
  });
  L.push('');
  L.push('## 图标资源');
  L.push('');
  L.push('- 提取的图标（可直接打开检查 deepseek 图形）：' + (report.apk.iconsExtracted.length ? report.apk.iconsExtracted.map((p) => BT + p + BT).join('、') : '无'));
  L.push('- foreground SHA-256：' + BT + (report.apk.iconHashes.foreground || '-') + BT);
  L.push('- monochrome SHA-256：' + BT + (report.apk.iconHashes.monochrome || '-') + BT + (report.apk.iconHashes.foregroundEqualsMonochrome ? '（与 foreground 相同；Android 13 主题图标用 alpha 蒙版自行着色，按约定可接受）' : ''));
  L.push('');
  L.push('## APK 内容摘要');
  L.push('');
  L.push('- 条目总数：' + (report.apk.entries.total || 0));
  L.push('- dex：' + ((report.apk.entries.dex || []).join(', ') || '-'));
  L.push('- mipmap launcher 图标：' + ((report.apk.entries.mipmaps || []).length) + ' 个');
  L.push('');
  return L.join('\n');
}

main();
