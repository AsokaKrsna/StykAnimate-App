// Builds the public library the website serves at /library/ and the app reads
// through desktop/public-library.cjs: catalog.json, files/<id>.stkz and
// previews/<id>.png (320 × 320, transparent, rendered by the app's own library
// preview after a real import of each file, as a saved library asset would be).
//
//   node scripts/build-public-library.mjs --out ../Siti/stykanimate/public/library
//
// Only free content belongs here. The AssetReleases packs are sold separately
// and are not published unless their owner decides otherwise. To publish more,
// add a pack to PACKS with items that return a native document.
import {mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {chromium} from '../tests/support/playwright.mjs';
import {RIG_EXAMPLES, rigExampleDocument} from '../src/rig-examples.mjs';
import {buildContainerV2} from '../src/native-container.mjs';
import {validateScene} from '../src/pivot/model.mjs';

const root = process.cwd(), option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const out = path.resolve(option('--out') ?? 'artifacts/public-library');
const rig = id => { const example = RIG_EXAMPLES.find(entry => entry.id === id); if (!example) throw new Error(`Unknown rig example ${id}`); return example; };
// What each asset is for, in the website's words (the app's rig descriptions explain the rigging).
const DESCRIPTIONS = {
  'counter-rotating-gears': 'Two meshed gears. Turn the drive and the second wheel spins the other way.',
  'folding-fan': 'A paper fan that opens and closes with a single handle.',
  'accordion-screen-3d': 'A four-panel folding screen that folds flat or stands open in 3D.',
  'expanding-crate-3d': 'A 3D crate that stretches wider while its depth adjusts to match.',
  'perspective-conveyor-3d': 'A conveyor running into the distance. Slide the frame toward the vanishing point.',
  'orbital-gyroscope-3d': 'Three hoops orbiting one centre, each turning on its own.',
  'turbine-3d': 'Eight blades spinning inside a round housing, drawn in 3D.',
  'solid-box-3d': 'A shaded 3D box that turns to any angle. Crates, buildings, steps and props.',
  'solid-cylinder-3d': 'A shaded 3D cylinder that turns to any angle. Pillars, barrels, cans and wheels.',
  'solid-wedge-3d': 'A shaded 3D wedge that turns to any angle. Ramps, roofs and blades.',
  'solid-pyramid-3d': 'A shaded 3D pyramid that turns to any angle. Spikes, roofs and monuments.',
  'solid-gem-3d': 'A faceted 3D gem that turns to any angle. Treasure, crystals and power-ups.',
  'glass-cube-3d': 'A see-through cube that turns in depth, with every edge visible.',
  'wire-globe-3d': 'A wireframe globe with latitude rings and a highlighted equator.',
  'double-helix-3d': 'A DNA-style double helix that twists as it turns.',
  'perspective-tunnel-3d': 'A corridor in perspective. Move the vanishing point to reshape it.',
};
const fromRig = id => ({id, name: rig(id).name, description: DESCRIPTIONS[id] ?? '', document: () => rigExampleDocument(id)});
const PACKS = [
  {id: 'mechanisms', name: 'Mechanisms', description: 'Rigged moving parts: gears, a folding fan, a conveyor and more. Pose them with the usual joint handles.',
    items: ['counter-rotating-gears', 'folding-fan', 'accordion-screen-3d', 'expanding-crate-3d', 'perspective-conveyor-3d', 'orbital-gyroscope-3d', 'turbine-3d'].map(fromRig)},
  {id: '3d-shapes', name: '3D shapes', description: 'Solid and wireframe shapes that turn in depth. Drag Turn to rotate them; hold Ctrl and drag Depth to change the view.',
    items: ['solid-box-3d', 'solid-cylinder-3d', 'solid-wedge-3d', 'solid-pyramid-3d', 'solid-gem-3d', 'glass-cube-3d', 'wire-globe-3d', 'double-helix-3d', 'perspective-tunnel-3d'].map(fromRig)},
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const {startBackend} = createRequire(import.meta.url)('../desktop/backend.cjs');
const backend = await startBackend({appRoot: root, resourcesPath: root, port: 0, log: () => {}, onError: error => { console.error(error); process.exit(1); }});
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage();
  await page.goto(backend.origin); await page.waitForFunction(() => window.styk?.ready, null, {timeout: 60000});
  // Only this build's files stay: the folders are replaced, never merged.
  for (const folder of ['files', 'previews']) { await rm(path.join(out, folder), {recursive: true, force: true}); await mkdir(path.join(out, folder), {recursive: true}); }
  const items = [], ids = new Set();
  for (const pack of PACKS) for (const source of pack.items) {
    if (ids.has(source.id)) throw new Error(`Duplicate public library id ${source.id}`);
    ids.add(source.id);
    const document = source.document(); validateScene(document);
    const bytes = Buffer.from(await buildContainerV2(document, 'stkz'));
    const rendered = await page.evaluate(async ({base64, name}) => {
      const {libraryPreview} = await import('/src/library-files.mjs');
      const {libraryPreviewMatte} = await import('/src/library-preview-core.mjs');
      const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], `${name}.stkz`);
      const result = await window.styk.library.importer.importFile(file), report = result.document ?? result.report ?? result;
      const preview = await libraryPreview(report), image = new Image(); image.src = preview; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40;
      const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0, 40, 40);
      return {preview, objects: report.keyframes[0].objects.length, matte: libraryPreviewMatte(context.getImageData(0, 0, 40, 40).data)};
    }, {base64: bytes.toString('base64'), name: source.name});
    const png = Buffer.from(rendered.preview.split(',')[1], 'base64');
    await writeFile(path.join(out, 'files', `${source.id}.stkz`), bytes);
    await writeFile(path.join(out, 'previews', `${source.id}.png`), png);
    items.push({id: source.id, name: source.name, kind: rendered.objects > 1 ? 'set' : 'figure', pack: pack.id, description: source.description,
      file: `files/${source.id}.stkz`, preview: `previews/${source.id}.png`, size: bytes.length, sha256: sha256(bytes), matte: rendered.matte});
    console.log(`${pack.name} · ${source.name} (${bytes.length.toLocaleString()} bytes)`);
  }
  const catalog = {format: 'stykanimate-public-library', version: 1, updated: new Date().toISOString().slice(0, 10),
    packs: PACKS.map(({id, name, description}) => ({id, name, description})), items};
  await writeFile(path.join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  const files = (await readdir(path.join(out, 'files'))).length;
  console.log(`Wrote ${items.length} assets in ${PACKS.length} packs (${files} files) to ${out}`);
} finally { await browser.close(); backend.stop(); }
