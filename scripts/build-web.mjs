// Builds the editor as a static site in build/web: the same files the desktop
// app serves from its resources, plus the in-browser Pivot codec.
//
//   npm run web:build        build/web
//   npm run web:verify       checks the result before it is deployed
//   npm run web:deploy       build, verify, then `wrangler deploy` (see docs/WEB.md)
//
// There is no bundler: the browser loads the same ES modules the desktop app
// does. The file set comes from the desktop packaging filter in package.json, so
// the two builds cannot drift apart.
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codecBundle } from './codec-bundle.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

/** The desktop app's `web` resource filter, so both builds ship the same files. */
export async function webFilter(root = appRoot) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const web = pkg.build.extraResources.find((item) => item.to === 'web');
  if (!web?.filter?.length) throw new Error('package.json has no "web" resource filter to build the site from.');
  return { filter: web.filter, version: pkg.version };
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Files under `root` selected by patterns of the forms `name`, `*.ext` and `dir/**\/*`. */
export async function selectFiles(root, patterns) {
  const selected = new Set();
  for (const pattern of patterns) {
    if (pattern.endsWith('/**/*')) {
      const directory = path.join(root, pattern.slice(0, -5));
      try { for await (const file of walk(directory)) selected.add(path.relative(root, file)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else if (pattern.startsWith('*.')) {
      const extension = pattern.slice(1);
      for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith(extension)) selected.add(entry.name);
    } else if (!/[*?]/.test(pattern)) {
      try { if ((await stat(path.join(root, pattern))).isFile()) selected.add(pattern); } catch { /* absent files are simply not shipped */ }
    } else throw new Error(`Unsupported packaging pattern: ${pattern}`);
  }
  return [...selected].sort();
}

export function markCodecMode(html) {
  const tag = '<meta name="styk-codec" content="browser" />';
  if (html.includes('name="styk-codec"')) return html;
  const head = html.indexOf('<head>');
  if (head < 0) throw new Error('index.html has no <head> to mark.');
  return `${html.slice(0, head + 6)}\n    ${tag}${html.slice(head + 6)}`;
}

export async function buildWeb({ root = appRoot, output = path.join(root, 'build', 'web') } = {}) {
  const { filter, version } = await webFilter(root);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  const files = await selectFiles(root, filter);
  for (const relative of files) {
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (relative === 'index.html') await writeFile(target, markCodecMode(await readFile(path.join(root, relative), 'utf8')));
    else await copyFile(path.join(root, relative), target);
  }

  // Pyodide runs the Pivot codec; only the files the loader requests are shipped.
  const pyodideSource = path.join(root, 'node_modules', 'pyodide');
  let pyodideVersion;
  try { pyodideVersion = JSON.parse(await readFile(path.join(pyodideSource, 'package.json'), 'utf8')).version; }
  catch { throw new Error('The Pivot codec runtime is missing. Run npm ci first.'); }
  const runtime = path.join(output, 'vendor', 'pyodide');
  await mkdir(runtime, { recursive: true });
  for (const name of PYODIDE_FILES) await copyFile(path.join(pyodideSource, name), path.join(runtime, name));
  await writeFile(path.join(runtime, 'NOTICE.txt'),
    `Pyodide ${pyodideVersion} (https://pyodide.org), distributed under the Mozilla Public License 2.0\n` +
    'with CPython (PSF License) and the packages it bundles. Source: https://github.com/pyodide/pyodide\n');

  await mkdir(path.join(output, 'python'), { recursive: true });
  const bundle = await codecBundle(root);
  await writeFile(path.join(output, 'python', 'codec-bundle.json'), JSON.stringify(bundle));

  await copyFile(path.join(root, 'web', '_headers'), path.join(output, '_headers'));

  let bytes = 0, count = 0;
  for await (const file of walk(output)) { bytes += (await stat(file)).size; count++; }
  // No timestamp: the same inputs produce the same site.
  await writeFile(path.join(output, 'build-info.json'), JSON.stringify({ app: 'StykAnimate', version, pyodide: pyodideVersion, codecFiles: Object.keys(bundle.files).length, files: count + 1 }, null, 2) + '\n');
  return { output, files: count + 1, bytes, version, pyodideVersion };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildWeb();
  console.log(`Built ${result.files} files (${(result.bytes / 1048576).toFixed(1)} MiB) for StykAnimate ${result.version} with Pyodide ${result.pyodideVersion} in ${path.relative(process.cwd(), result.output)}`);
}

