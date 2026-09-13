import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUIScale, applyUIScale} from '../src/ui-scale.mjs';
import {normalizeEditorSettings} from '../src/settings.mjs';
test('UI scale migrates old settings and rejects invalid stored values',()=>{
 for(const value of [undefined,null,NaN,Infinity,'150',{},[]]) assert.equal(normalizeUIScale(value),100);
 assert.equal(normalizeEditorSettings({}).uiScale,100);
 assert.equal(normalizeEditorSettings({uiScale:157}).uiScale,155);
 assert.equal(normalizeUIScale(-1),75);assert.equal(normalizeUIScale(900),200);
});
test('UI scale uses a bounded native presentation API',()=>{
 const values=[];assert.equal(applyUIScale(128,{setUIScale:value=>values.push(value)}),130);
 assert.deepEqual(values,[130]);assert.equal(applyUIScale(150,{}),150);
});
