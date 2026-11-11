#!/usr/bin/env node
/**
 * Install the built APK on a running Android emulator/device, launch it, take
 * screenshots and collect crash logs. Verifier-owned (tools/verify).
 *
 * Usage:
 *   node tools/verify/run-emulator-check.mjs
 *   node tools/verify/run-emulator-check.mjs --apk app/android/app/build/outputs/apk/debug/app-debug.apk
 *   node tools/verify/run-emulator-check.mjs --serial emulator-5554 --out-dir docs/verification/screenshots
 *
 * Writes JSON (tools/verify/.emulator-report.json) + markdown
 * (docs/verification/app-emulator-report.md) and PNG screenshots.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const BT = String.fromCharCode(96);
const ADB = process.env.ADB || 'D:\\Android\\Sdk\\platform-tools\\adb.exe';
const RESULTS = [];

function adb(serial, args, opts = {}) {
  const full = serial ? ['-s', serial, ...args] : args;
  const r = spawnSync(ADB, full, { encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 60000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function adbText(serial, args, opts = {}) {
  const r = adb(serial, args, opts);
  return String(r.stdout || '') + (r.stderr ? '\n' + String(r.stderr) : '');
}

function check(name, fn, opts = {}) {
  const t0 = Date.now();
  try {
    const detail = fn();
    RESULTS.push({ name, status: 'pass', detail, durationMs: Date.now() - t0 });
    console.log('PASS ' + name + (detail ? ' :: ' + JSON.stringify(detail).slice(0, 240) : ''));
    return detail;
  } catch (e) {
    const status = opts.severity === 'warn' ? 'warn' : 'fail';
    const message = e && e.message ? e.message : String(e);
    RESULTS.push({ name, status, error: message, durationMs: Date.now() - t0 });
    console.log((status === 'fail' ? 'FAIL ' : 'WARN ') + name + ' :: ' + message);
    return undefined;
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
      else if (name.endsWith('.apk')) found.push({ path: p, mtime: st.mtimeMs });
    }
  };
  walk(base);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] ? found[0].path : null;
}

function screencap(serial, outPath) {
  const r = adb(serial, ['exec-out', 'screencap', '-p'], { buffer: true });
  if (r.status !== 0 || !r.stdout || r.stdout.length < 1000) {
    throw new Error('adb exec-out screencap failed (status ' + r.status + ', bytes ' + (r.stdout ? r.stdout.length : 0) + ')');
  }
  writeFileSync(outPath, r.stdout);
  return { path: outPath, bytes: r.stdout.length };
}

function main() {
  const { values: args } = parseArgs({
    options: {
      apk: { type: 'string' },
      serial: { type: 'string', default: '' },
      'out-dir': { type: 'string', default: 'docs/verification/screenshots' },
      'json-out': { type: 'string', default: 'tools/verify/.emulator-report.json' },
      report: { type: 'string', default: 'docs/verification/app-emulator-report.md' },
      'launch-wait': { type: 'string', default: '5000' },
      'skip-install': { type: 'boolean', default: false },
      package: { type: 'string', default: 'dev.dsh.remote' },
      activity: { type: 'string', default: 'dev.dsh.remote/.MainActivity' },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  const startedAt = new Date();
  const outDir = resolve(args['out-dir']);
  mkdirSync(outDir, { recursive: true });
  const jsonOut = resolve(args['json-out']);
  const reportPath = resolve(args.report);
  const waitMs = Number(args['launch-wait']);
  const report = { tool: 'run-emulator-check.mjs', startedAt: startedAt.toISOString(), adb: ADB, package: args.package, activity: args.activity, apk: null, serial: null, screenshots: [], logcat: null, counts: null, ok: false, results: RESULTS };

  check('adb.available', () => {
    require_(existsSync(ADB), 'adb not found at ' + ADB + ' (set ADB env or --serial)');
    const out = adbText(args.serial, ['version']);
    require_(/Android Debug Bridge/.test(out), 'unexpected adb output: ' + out.slice(0, 200));
    return { adb: ADB };
  }, { severity: 'fail' });

  check('device.connected', () => {
    const out = adbText(args.serial, ['devices']);
    const devices = out.split(/\r?\n/).filter((l) => /\tdevice$/.test(l)).map((l) => l.split('\t')[0]);
    require_(devices.length > 0, 'no adb device in "device" state: ' + out.trim());
    report.serial = args.serial || devices[0];
    const props = adbText(report.serial, ['shell', 'getprop', 'ro.build.version.sdk']).trim();
    const model = adbText(report.serial, ['shell', 'getprop', 'ro.product.model']).trim();
    const size = adbText(report.serial, ['shell', 'wm', 'size']).trim();
    return { serial: report.serial, devices, sdk: props, model, size };
  }, { severity: 'fail' });

  check('apk.locate', () => {
    const apk = args.apk ? resolve(args.apk) : findDefaultApk();
    require_(apk, 'no APK found; pass --apk');
    require_(existsSync(apk), 'APK missing: ' + apk);
    report.apk = { path: apk, bytes: statSync(apk).size, mtime: statSync(apk).mtime.toISOString() };
    return report.apk;
  }, { severity: 'fail' });

  const installed = check('apk.install', () => {
    if (args['skip-install']) return { skipped: true };
    const r = adbText(report.serial, ['install', '-r', '-t', report.apk.path], { timeoutMs: 180000 });
    require_(/Success/i.test(r), 'adb install failed: ' + r.slice(0, 600));
    const total = /TotalTime: (\d+)/.exec(r);
    return { installOutput: r.trim().slice(0, 400), totalTime: total ? Number(total[1]) : null };
  }, { severity: 'fail' });

  if (installed) {
    check('package.installed', () => {
      const out = adbText(report.serial, ['shell', 'pm', 'list', 'packages', args.package]);
      require_(out.includes('package:' + args.package), 'package ' + args.package + ' not installed');
      const dumpsys = adbText(report.serial, ['shell', 'dumpsys', 'package', args.package]);
      const version = /versionName=([^\s]+)/.exec(dumpsys);
      return { package: args.package, versionName: version ? version[1] : null };
    });

    check('app.launch', () => {
      adbText(report.serial, ['logcat', '-c']);
      adbText(report.serial, ['shell', 'am', 'force-stop', args.package]);
      const out = adbText(report.serial, ['shell', 'am', 'start', '-W', '-n', args.activity], { timeoutMs: 60000 });
      const total = /TotalTime: (\d+)/.exec(out);
      require_(/Status: ok|Starting: Intent/i.test(out), 'am start failed: ' + out.slice(0, 400));
      return { output: out.trim().slice(0, 400), totalTime: total ? Number(total[1]) : null };
    }, { severity: 'fail' });

    check('app.running', () => {
      const pidOut = adbText(report.serial, ['shell', 'pidof', args.package]).trim();
      require_(pidOut.length > 0, 'process for ' + args.package + ' is not running after launch');
      return { pid: pidOut };
    }, { severity: 'fail' });

    check('app.screenshot-pairing', () => {
      const shot = screencap(report.serial, join(outDir, 'app-01-pairing.png'));
      report.screenshots.push(shot);
      return shot;
    }, { severity: 'warn' });

    check('app.activity-resumed', () => {
      const out = adbText(report.serial, ['shell', 'dumpsys', 'activity', 'activities']);
      const resumed = /(?:mResumedActivity|topResumedActivity)[^\n]*/.exec(out);
      require_(resumed, 'no mResumedActivity in dumpsys');
      require_(resumed[0].includes(args.package), 'resumed activity is not ' + args.package + ': ' + resumed[0]);
      return { resumed: resumed[0].trim() };
    }, { severity: 'warn' });
  }

  check('app.logcat-crash-scan', () => {
    if (!report.serial) throw new Error('no device');
    const out = adbText(report.serial, ['logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E', 'ReactNative:E']);
    report.logcat = out.trim().slice(0, 8000);
    const fatals = out.split(/\r?\n/).filter((l) => /FATAL EXCEPTION|AndroidRuntime.*FATAL/.test(l));
    require_(fatals.length === 0, 'crash in logcat: ' + fatals.slice(0, 3).join(' | '));
    return { crashLines: fatals.length, sample: out.trim().split(/\r?\n/).slice(0, 8) };
  }, { severity: 'fail' });

  const finishedAt = new Date();
  const counts = { pass: 0, fail: 0, warn: 0 };
  for (const r of RESULTS) counts[r.status] += 1;
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt - startedAt;
  report.counts = counts;
  report.ok = counts.fail === 0;
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderMarkdown(report));
  console.log('\n' + JSON.stringify(counts) + ' -> ' + jsonOut + ', ' + reportPath);
  if (!report.ok) process.exitCode = 1;
}

function renderMarkdown(report) {
  const L = [];
  L.push('# DSH Remote Android 模拟器安装 / 启动 / 截图报告');
  L.push('');
  L.push('- 生成时间：' + report.finishedAt);
  L.push('- 设备：' + (report.serial || '-'));
  L.push('- 包名 / 入口：' + BT + report.package + BT + ' / ' + BT + report.activity + BT);
  L.push('- APK：' + (report.apk ? BT + report.apk.path + BT + '（' + (report.apk.bytes / 1024 / 1024).toFixed(2) + ' MB）' : '-'));
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
  if (report.screenshots.length) {
    L.push('## 截图');
    L.push('');
    for (const s of report.screenshots) {
      L.push('- ' + BT + s.path + BT + '（' + s.bytes + ' bytes）');
    }
    L.push('');
  }
  if (report.logcat) {
    L.push('## logcat（AndroidRuntime:E / ReactNativeJS:E，截取）');
    L.push('');
    L.push(BT + BT + BT + 'text');
    L.push(report.logcat.slice(0, 4000));
    L.push(BT + BT + BT);
    L.push('');
  }
  return L.join('\n');
}

main();
