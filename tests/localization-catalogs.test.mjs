import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import english from '../src/locales/en.mjs';
import { validateCatalog } from '../src/locales/catalog-validation.mjs';
import { Localization, messageText, pseudolocalize } from '../src/localization.mjs';

const locale = {id: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl'};
test('catalog validation rejects unknown keys, malformed messages and changed placeholders', () => {
  for (const messages of [
    {'unknown.caption': 'Unknown'}, {'common.save': '<b>Save</b>'},
    {'common.save': 'Save {bad'}, {'timeline.frameOf': 'Frame {wrong} of {total}'},
    {'timeline.selectedFrames': {one: '{count} frame'}},
    {'timeline.selectedFrames': {other: '{count} frames', banana: '{count} frames'}},
    {'common.save': '\u0000Save'}, {'common.save': ''},
  ]) assert.ok(validateCatalog({locale, messages}, english).errors.length, JSON.stringify(messages));
});
test('intentional fallback reports missing messages and language-specific plural forms', () => {
  const report = validateCatalog({locale, messages: {'timeline.selectedFrames': {other: '{count} frames'}}}, english);
  assert.deepEqual(report.errors, []);
  assert.ok(report.missing.includes('common.save'));
  assert.deepEqual(report.incompletePlurals, [{key:'timeline.selectedFrames', forms:['zero','one','two','few','many']}]);
  assert.equal(new Localization({locale: 'ar'}).t('timeline.selectedFrames', {count: 1}), `${new Intl.NumberFormat('ar').format(1)} selected frame`);
});
test('all independent packs validate against one authoritative English catalog', async () => {
  assert.deepEqual(validateCatalog({locale: {...locale, id:'en'}, messages: english}, english).errors, []);
  for (const file of await readdir('src/locales/packs')) {
    const pack = JSON.parse(await readFile(`src/locales/packs/${file}`, 'utf8'));
    assert.deepEqual(validateCatalog(pack, english).errors, [], file);
  }
  assert.equal(messageText(null, 'settings.touchInterface'), 'Touch interface');
  assert.equal(messageText(null, 'inspector.mixed'), 'Mixed');
});
test('pseudo modes expand literal copy while preserving placeholders and locale preferences', () => {
  assert.ok(pseudolocalize('Save').length > 'Save'.length * 1.5);
  assert.ok(pseudolocalize('Frame {frame}', 'rtl').includes('{frame}'));
  const localization = new Localization();
  let calls = 0; localization.subscribe(() => calls++);
  localization.setPseudo('rtl');
  assert.equal(localization.direction, 'rtl'); assert.equal(localization.locale, 'en');
  assert.ok(localization.t('timeline.frameOf', {frame: 2, total: 10}).includes('2'));
  assert.equal(calls, 1);
  localization.setPseudo(null); assert.equal(localization.direction, 'ltr');
});
