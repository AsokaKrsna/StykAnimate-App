// Checks a built site (build/web) before it is deployed. Everything here is a
// mistake that would otherwise only show up in production: a module the app
// imports that was not shipped, a file over Cloudflare's size limit, a headers
// file Cloudflare would reject, or a private file that leaked into the site.
//
//   node scripts/verify-web.mjs [build/web]
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PYODIDE_FILES } from './build-web.mjs';
import { parseHeaders } from './serve-web.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Cloudflare Workers static assets: https://developers.cloudflare.com/workers/static-assets/
export const LIMITS = { files: 20000, fileBytes: 25 * 1024 * 1024, headerRules: 100, headerLine: 2000 };
const REQUIRED = ['index.html', '_headers', 'build-info.json', 'python/codec-bundle.json', 'src/app.mjs', 'src/codec-web-worker.mjs',
  'src/codec-web-engine.mjs', ...PYODIDE_FILES.map((name) => `vendor/pyodide/${name}`)];
const PRIVATE = /(^|\/)(\.env[^/]*|telemetry-build\.json|[^/]+\.(pem|key|p12)|desktop|backend|codecs|cloud|node_modules)(\/|$)/;

async function listFiles(root, directory = root, out = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await listFiles(root, full, out);
    else out.set(path.relative(root, full).split(path.sep).join('/'), (await stat(full)).size);
  }
  return out;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Relative module and asset references in a source file that must exist in the site. */
export function relativeReferences(source) {
  const text = withoutComments(source), found = new Set();
  const patterns = [
    /(?:^|[\n;}])\s*(?:import|export)\s*(?:[^'";]*?\sfrom\s*)?(['"])(\.{1,2}\/[^'"\n]+)\1/g,
    /\bimport\(\s*(['"])(\.{1,2}\/[^'"\n]+)\1\s*\)/g,
    /new URL\(\s*(['"])(\.{1,2}\/[^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[2].split(/[?#]/)[0]);
  return [...found];
}

export async function verifyWeb(root = path.join(appRoot, 'build', 'web')) {
  const problems = [];
  const files = await listFiles(root);
  const fail = (message) => problems.push(message);

  for (const name of REQUIRED) if (!files.has(name)) fail(`Missing ${name}.`);
  if (files.size > LIMITS.files) fail(`${files.size} files exceed Cloudflare's ${LIMITS.files}-file limit.`);
  for (const [name, size] of files) {
    if (size > LIMITS.fileBytes) fail(`${name} is ${(size / 1048576).toFixed(1)} MiB, over Cloudflare's ${LIMITS.fileBytes / 1048576} MiB per-file limit.`);
    if (PRIVATE.test(name)) fail(`${name} must not be part of the public site.`);
  }

  if (files.has('index.html')) {
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    if (!/<meta name="styk-codec" content="browser"\s*\/?>/.test(html)) fail('index.html does not select the in-browser codec.');
    for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#?]+)/g)) {
      if (!files.has(match[1].slice(2))) fail(`index.html references ${match[1]}, which is not in the site.`);
    }
  }

  // Every module the app can load must have been shipped.
  for (const name of files.keys()) {
    if (!/\.(mjs|js)$/.test(name) || name.startsWith('vendor/pyodide/')) continue;
    const directory = path.posix.dirname(name);
    for (const reference of relativeReferences(await readFile(path.join(root, name), 'utf8'))) {
      const target = path.posix.normalize(path.posix.join(directory, reference));
      // A reference ending in "/" names a directory, which must contain files.
      const present = reference.endsWith('/') ? [...files.keys()].some((file) => file.startsWith(target)) : files.has(target);
      if (!present) fail(`${name} imports ${reference}, which is not in the site.`);
    }
  }

  if (files.has('_headers')) {
    const text = await readFile(path.join(root, '_headers'), 'utf8');
    try {
      const rules = parseHeaders(text);
      if (rules.length > LIMITS.headerRules) fail(`_headers has ${rules.length} rules; Cloudflare accepts ${LIMITS.headerRules}.`);
    } catch (error) { fail(error.message); }
    for (const line of text.split(/\r?\n/)) if (line.length > LIMITS.headerLine) fail(`A _headers line is ${line.length} characters; Cloudflare accepts ${LIMITS.headerLine}.`);
    if (!/^\s*Content-Security-Policy:.*script-src 'self'/m.test(text)) fail('_headers has no Content-Security-Policy that restricts scripts.');
  }

  if (files.has('python/codec-bundle.json')) {
    try {
      const bundle = JSON.parse(await readFile(path.join(root, 'python', 'codec-bundle.json'), 'utf8'));
      for (const required of ['backend/server.py', 'backend/browser_service.py', 'codecs/codec_bridge.py', 'codecs/piv_codec.py']) {
        if (typeof bundle.files?.[required] !== 'string') fail(`The codec bundle is missing ${required}.`);
      }
    } catch (error) { fail(`python/codec-bundle.json is unreadable: ${error.message}`); }
  }

  if (files.has('build-info.json')) {
    const info = JSON.parse(await readFile(path.join(root, 'build-info.json'), 'utf8'));
    const pkg = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
    if (info.version !== pkg.version) fail(`The build is version ${info.version} but package.json is ${pkg.version}; rebuild.`);
  }
  return { problems, files: files.size, bytes: [...files.values()].reduce((sum, size) => sum + size, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? path.join(appRoot, 'build', 'web'));
  const result = await verifyWeb(root).catch((error) => ({ problems: [error.code === 'ENOENT' ? 'Nothing is built. Run npm run web:build first.' : error.message], files: 0, bytes: 0 }));
  if (result.problems.length) {
    console.error(`The site is not ready to deploy (${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}):`);
    for (const problem of result.problems) console.error(` - ${problem}`);
    process.exitCode = 1;
  } else console.log(`The site is ready to deploy: ${result.files} files, ${(result.bytes / 1048576).toFixed(1)} MiB.`);
}
