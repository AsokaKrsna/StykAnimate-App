/** Real desktop import without an attached DevTools/Playwright session. */
import electron from 'electron';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performanceSourceHashes} from './performance-source-hashes.mjs';
import {POLICY_VERSION} from '../src/telemetry-schema.mjs';

assert.ok(process.argv[2], 'Provide a read-only PIV fixture');
const source = path.resolve(process.argv[2]), label = process.argv[3] || String(Date.now());
assert.match(label, /^[a-zA-Z0-9_-]+$/, 'Use a plain artifact label');
const runs = Number(process.argv[4] || 3); assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 20);
const output = path.resolve('artifacts/performance-goal', label);
await mkdir(output, {recursive: true});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(source);
const report = {at: new Date().toISOString(), source: {name: path.basename(source), bytes: sourceBytes.length, sha256: hash(sourceBytes)},
  sourceHashes: await performanceSourceHashes(), rows: [],
  limitations: ['No attached debugger. Source Electron with fresh profiles; OS caches are not flushed.',
    'Startup includes process launch and a readiness probe. Two rAFs establish submission readiness, not physical scanout.',
    'Process working-set sums can count shared pages repeatedly. Other workstation activity is not controlled.']};
let expectedDigest;
for (let run = 0; run < runs; run++) {
  const directory = path.join(output, String(run)); await mkdir(directory, {recursive: true});
  const env = {...process.env, STYK_BENCH_INPUT: source, STYK_BENCH_OUTPUT: directory,
    STYK_USER_DATA_DIR: path.join(directory, 'profile'), STYK_LIBRARY_DIR: path.join(directory, 'library')};
  await mkdir(env.STYK_USER_DATA_DIR, {recursive: true});
  await writeFile(path.join(env.STYK_USER_DATA_DIR, 'telemetry-state.json'), JSON.stringify({decided: true,
    consent: {analytics: false, diagnostics: false, policyVersion: POLICY_VERSION, updatedAt: Date.now()}}), {flag: 'wx'});
  delete env.ELECTRON_RUN_AS_NODE;
  const launched = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['scripts/benchmark-performance-desktop.cjs'], {cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {log = (log + chunk).slice(-20000);});
    const timeout = setTimeout(() => {child.kill();}, 240000);
    child.on('error', error => {clearTimeout(timeout); reject(error);});
    child.on('exit', code => {
      clearTimeout(timeout);
      writeFile(path.join(directory, 'process.log'), log).then(() => code === 0 ? resolve() : reject(new Error(`Desktop benchmark exited ${code}: ${log.slice(-2000)}`)), reject);
    });
  });
  const row = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
  row.launchToReadyMs = row.readyAt - launched;
  expectedDigest ??= row.digest; assert.equal(row.digest, expectedDigest, 'Every run must produce the same editable scene');
  report.rows.push(row);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({run, startupMs: row.launchToReadyMs, importMs: row.imported.ms, scene: row.imported.renderer.initialPreparation, output}));
}
report.sourceUnchanged = hash(await readFile(source)) === report.source.sha256;
const final = await performanceSourceHashes();
report.changedSourcePaths = [...new Set([...Object.keys(final), ...Object.keys(report.sourceHashes)])].filter(key => final[key] !== report.sourceHashes[key]);
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
assert.equal(report.sourceUnchanged, true);
assert.deepEqual(report.changedSourcePaths, [], 'Sources changed during the measurement');
