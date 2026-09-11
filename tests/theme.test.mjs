import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeEditorSettings} from '../src/settings.mjs';

const bootstrap = readFileSync(new URL('../src/theme-bootstrap.js', import.meta.url), 'utf8');
function boot(values = {}, desktop, dark = false) {
  const dataset = {}, meta = {};
  const window = desktop ? {stykDesktop:{getEditorSettings:desktop}} : {};
  window.matchMedia = () => ({matches:dark});
  runInNewContext(bootstrap, {
    window,
    document: {documentElement:{dataset}, querySelector:() => ({setAttribute:(key,value) => {meta[key]=value;}})},
    localStorage: {getItem:key => {if (values instanceof Error) throw values; return values[key] ?? null;}},
  });
  return {dataset,meta,window};
}

test('Legacy, malformed and missing theme settings default to system', () => {
  for (const theme of [undefined,null,'system','DARK',1,{},true])
    assert.equal(normalizeEditorSettings({theme}).theme,'system');
  assert.equal(normalizeEditorSettings({theme:'dark'}).theme,'dark');
  assert.equal(normalizeEditorSettings({theme:'light'}).theme,'light');
  assert.equal(normalizeEditorSettings(null).theme,'system');
});

test('System appearance is resolved during browser and native bootstrap', async () => {
  for (const values of [{}, new Error('Storage denied'), {'stykanimate.theme.v1':'system'}])
    assert.equal(boot(values, undefined, true).dataset.theme, 'dark');
  assert.equal(boot({'stykanimate.theme.v1':'light'}, undefined, true).dataset.theme, 'light');
  const result = boot({}, () => ({}), true);
  await result.window.stykInitialEditorSettings;
  assert.equal(result.dataset.theme, 'dark');
});

test('Browser bootstrap restores the saved appearance without waiting for modules', () => {
  for (const values of [
    {'stykanimate.theme.v1':'dark'},
    {'stykanimate.editor.settings.v1':'{"theme":"dark"}'},
  ]) {
    const {dataset,meta}=boot(values);
    assert.equal(dataset.theme,'dark');
    assert.equal(meta.content,'#202227');
  }
  for (const values of [{},new Error('Storage denied'),{'stykanimate.editor.settings.v1':'invalid'}])
    assert.equal(boot(values).dataset.theme,'light');
});

test('Native preferences win on a new backend origin before revealing the workspace', async () => {
  let resolve;
  const native = new Promise(done => {resolve=done;});
  const result=boot({}, () => native);
  assert.ok('themePending' in result.dataset);
  resolve({theme:'dark',locale:'it'});
  const settings=await result.window.stykInitialEditorSettings;
  assert.equal(settings.theme,'dark');
  assert.equal(result.dataset.theme,'dark');
  assert.equal(result.meta.content,'#202227');
  assert.ok(!('themePending' in result.dataset));
  const light=boot({'stykanimate.theme.v1':'dark'}, () => ({theme:'light'}));
  await light.window.stykInitialEditorSettings;
  assert.equal(light.dataset.theme,'light');
});

test('A native preference read failure cannot leave the workspace hidden', async () => {
  const result=boot({}, () => {throw new Error('IPC unavailable');});
  assert.equal(await result.window.stykInitialEditorSettings,undefined);
  assert.equal(result.dataset.theme,'light');
  assert.ok(!('themePending' in result.dataset));
});
