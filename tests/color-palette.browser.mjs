import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from './support/playwright.mjs';
// The shared palette: every colour picker offers the project's colours or the
// recent ones, saving a colour is one undoable edit that reopens with the
// project, and Draw's colour rail shows the same palette.
const output='artifacts/color-palette';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.stack));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const project=()=>page.evaluate(()=>styk.editor.report._styk.palette?.colors??[]);
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const picker=page.locator('.paint-picker');
try{
  await page.goto(process.env.STYK_URL??'http://127.0.0.1:47839');await page.waitForFunction(()=>window.styk?.ready);
  await page.evaluate(async()=>{
    styk.state.settings.autosaveSeconds=0;
    const {emptyDocument,createFrame,createObject}=await import('/src/demo.mjs');
    const report=emptyDocument();report.keyframes=[createFrame([createObject(report.figure_types[0],1,320,250)])];
    styk.editor.load(report);styk.editor.select(styk.editor.evaluatedFrame.objects[0].unique_id);
  });
  await frame();

  // Animate: the figure's colour picker ends with the palette.
  await page.locator('#figure-color').click();await picker.waitFor();
  check('a new project starts on the recent colours with + offered',await page.evaluate(()=>{
    const p=document.querySelector('.paint-picker .paint-palette');
    return p.querySelector('[data-palette-view="recent"]').getAttribute('aria-pressed')==='true'&&!p.querySelector('[data-palette-add]').disabled&&Boolean(p.querySelector('.paint-palette-empty'));
  }));
  await picker.locator('[data-hex]').fill('E0452B');await picker.locator('[data-hex]').press('Enter');
  await picker.locator('[data-palette-add]').click();
  check('+ saves the colour to the project and switches to its colours',JSON.stringify(await project())==='["#e0452b"]'
    &&await picker.locator('[data-palette-view="project"]').getAttribute('aria-pressed')==='true'
    &&await picker.locator('[data-palette-swatch="#e0452b"]').getAttribute('aria-pressed')==='true'
    &&await picker.locator('[data-palette-add]').isDisabled());
  const kept=await page.evaluate(()=>({revision:styk.editor.revision,playback:styk.state.playbackRevision}));
  check('saving a colour keeps playback prepared',kept.playback===kept.revision);
  for(const hex of ['1F6FEB','2DA44E'])await page.evaluate(hex=>styk.editor.addPaletteColor('#'+hex),hex);
  await frame();
  check('the open picker follows project changes',await picker.locator('[data-palette-swatch]').count()===3);
  await page.screenshot({path:`${output}/picker-animate.png`,clip:await picker.boundingBox()});
  await picker.locator('[data-palette-swatch="#1f6feb"]').click();
  check('a project swatch recolours the figure',await page.evaluate(()=>styk.editor.figurePalette()[0]?.color)==='#1f6feb');
  await picker.locator('[data-palette-swatch="#2da44e"]').dragTo(picker.locator('[data-palette-swatch="#e0452b"]'));
  check('dragging a swatch reorders the project colours',JSON.stringify(await project())==='["#2da44e","#e0452b","#1f6feb"]');
  await picker.locator('[data-palette-swatch="#e0452b"]').click({button:'right'});
  check('right-click removes a project colour',JSON.stringify(await project())==='["#2da44e","#1f6feb"]');
  await picker.locator('[data-palette-swatch="#2da44e"]').focus();await page.keyboard.press('ArrowRight');
  check('arrow keys move between swatches',await page.evaluate(()=>document.activeElement?.dataset.paletteSwatch)==='#1f6feb');
  await page.keyboard.press('Escape');
  check('the colour the picker ends on joins the recent colours',await page.evaluate(()=>styk.drawing.library.recent[0])==='#1f6feb');
  await page.evaluate(()=>styk.editor.undo());
  check('a palette edit undoes on its own',JSON.stringify(await project())==='["#2da44e","#e0452b","#1f6feb"]');
  await page.evaluate(()=>styk.editor.redo());

  // Draw: the rail beside the colour pair shows the same project colours.
  await page.locator('[data-workspace-mode="draw"]').click();
  await page.locator('[data-tool="drawing-brush"]').click();
  await page.evaluate(()=>{styk.drawing.settings.color='#8250df';styk.drawing.onUI();});
  const rail=page.locator('.drawing-quickbar .draw-quick-swatches');await rail.waitFor();
  check('Draw’s rail shows the project colours and + for the brush colour',
    await rail.locator('[data-draw-color]').count()===2&&await rail.locator('[data-draw-action="add-palette-color"]').count()===1);
  await rail.locator('[data-draw-action="add-palette-color"]').click();await frame();
  check('the rail’s + saves the brush colour',JSON.stringify(await project())==='["#2da44e","#1f6feb","#8250df"]'
    &&await rail.locator('[data-draw-action="add-palette-color"]').count()===0
    &&await rail.locator('[data-draw-color="#8250df"]').getAttribute('aria-pressed')==='true');
  await rail.locator('[data-draw-color="#2da44e"]').click();
  check('a rail swatch sets the brush colour',await page.evaluate(()=>styk.drawing.settings.color)==='#2da44e');
  await page.evaluate(()=>{for(const hex of ['#cf222e','#bf8700','#0969da','#6639ba','#1b1f24','#ffffff','#fd8c73'])styk.editor.addPaletteColor(hex);});await frame();
  check('the rail keeps to eight colours and +N opens the rest',await rail.locator('[data-draw-color]').count()===8&&(await rail.locator('[data-draw-action="open-colors"]').textContent())==='+2');
  await page.screenshot({path:`${output}/draw-rail.png`,clip:await page.locator('.drawing-quickbar').boundingBox()});
  await rail.locator('[data-draw-action="open-colors"]').click();await picker.waitFor();
  check('+N opens the brush picker with every project colour',await picker.locator('[data-palette-swatch]').count()===10);
  await page.screenshot({path:`${output}/picker-draw.png`,clip:await picker.boundingBox()});
  await picker.locator('[data-palette-view="recent"]').click();await frame();
  check('choosing Recent in the picker switches the rail too',await page.locator('.drawing-quickbar .draw-quick-swatches').getAttribute('aria-label')==='Recent colors');
  await picker.locator('[data-palette-view="project"]').click();
  await page.keyboard.press('Escape');

  // The palette is saved with the project and reopens with it.
  const reopened=await page.evaluate(async()=>{
    const {buildContainerV2,decodeDocument}=await import('/src/native-container.mjs');
    const {document}=await decodeDocument(await buildContainerV2(styk.editor.report,'styk'),'styk');
    return document._styk.palette.colors.length;
  });
  check('the project colours are saved in the project file',reopened===10);
  // Personal palettes: named, kept on this computer, offered in every project.
  const primary=page.locator('.drawing-quickbar .draw-color-primary');
  await primary.click();await picker.waitFor();
  await picker.locator('[data-palette-menu]').click();
  check('Mine opens the personal palettes in place of the grid',await picker.locator('.paint-palette-menu').count()===1&&await picker.locator('.paint-palette-grid').count()===0
    &&await picker.locator('[data-palette-menu]').getAttribute('aria-expanded')==='true');
  await page.keyboard.press('Escape');
  check('Escape closes the palette list, not the picker',await picker.count()===1&&await picker.locator('.paint-palette-grid').count()===1);
  await picker.locator('[data-palette-menu]').click();await picker.locator('[data-palette-new]').click();
  check('New palette asks for a name, suggested and selected',await picker.locator('[data-palette-name]').inputValue()==='My palette'
    &&await page.evaluate(()=>document.activeElement?.matches('[data-palette-name]')));
  await page.keyboard.type('Skin tones');await page.keyboard.press('Enter');
  check('the new palette is shown, empty, with its name on the switch',(await picker.locator('[data-palette-menu]').textContent()).trim()==='Skin tones'
    &&await picker.locator('.paint-palette-empty').count()===1&&!await picker.locator('[data-palette-add]').isDisabled());
  await picker.locator('[data-hex]').fill('F1C27D');await picker.locator('[data-hex]').press('Enter');
  await picker.locator('[data-palette-add]').click();
  await picker.locator('[data-hex]').fill('C68642');await picker.locator('[data-hex]').press('Enter');
  await picker.locator('[data-palette-add]').click();
  check('+ saves colours to the personal palette, not the project',await picker.locator('[data-palette-swatch]').count()===2
    &&(await project()).length===10&&await picker.locator('[data-palette-add]').getAttribute('title')==='#C68642 is in Skin tones');
  await page.screenshot({path:`${output}/picker-personal.png`,clip:await picker.boundingBox()});
  await picker.locator('[data-palette-menu]').click();
  await page.screenshot({path:`${output}/picker-personal-menu.png`,clip:await picker.boundingBox()});
  await picker.locator('[data-palette-to-project]').click();
  check('Add to this project copies the palette in one step and shows the project',(await project()).length===12
    &&await picker.locator('[data-palette-view="project"]').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>styk.editor.undo());await frame();
  check('copying a palette into the project undoes in one step',(await project()).length===10);
  await picker.locator('[data-palette-menu]').click();await picker.locator('[data-palette-copy]').click();
  await picker.locator('[data-palette-name]').fill('Night scene');await picker.locator('[data-palette-name]').press('Enter');
  check('Save project colors as a palette keeps them for other projects',await picker.locator('[data-palette-swatch]').count()===10
    &&(await picker.locator('[data-palette-menu]').textContent()).trim()==='Night scene');
  await picker.locator('[data-palette-menu]').click();
  await picker.locator('.paint-palette-item[data-palette-pick]').filter({hasText:'Skin tones'}).click();
  check('choosing a palette from the list shows it',await picker.locator('[data-palette-swatch]').count()===2);
  await picker.locator('[data-palette-menu]').click();await picker.locator('[data-palette-rename]').click();
  await picker.locator('[data-palette-name]').fill('Skin');await picker.locator('[data-palette-name]').press('Enter');
  check('Rename renames the shown palette',(await picker.locator('[data-palette-menu]').textContent()).trim()==='Skin');
  await page.keyboard.press('Escape');await picker.waitFor({state:'detached'});
  const personalRail=page.locator('.drawing-quickbar .draw-quick-swatches');
  await page.evaluate(()=>{styk.drawing.settings.color='#8d5524';styk.drawing.onUI();});await frame();
  check('Draw’s rail shows the personal palette and saves to it',await personalRail.getAttribute('aria-label')==='Skin'
    &&await personalRail.locator('[data-draw-action="add-palette-color"]').getAttribute('title')==='Add #8D5524 to Skin');
  await personalRail.locator('[data-draw-action="add-palette-color"]').click();await frame();
  check('the rail’s + adds to the personal palette',await personalRail.locator('[data-draw-color]').count()===3);
  await page.reload();await page.waitForFunction(()=>window.styk?.ready);
  const survived=await page.evaluate(async()=>{const m=await import('/src/color-palette.mjs');return m.personalPalettes().map(p=>`${p.name}:${p.colors.length}`).join();});
  check('personal palettes survive a restart, in the order made',survived==='Skin:3,Night scene:10');
  await page.locator('[data-workspace-mode="draw"]').click();await page.locator('[data-tool="drawing-brush"]').click();
  await primary.click();await picker.waitFor();
  await picker.locator('[data-palette-menu]').click();await picker.locator('[data-palette-delete]').click();
  check('Delete asks before removing a palette',(await picker.locator('.paint-palette-form p').textContent()).includes('Delete “Skin” and its 3 colors?'));
  await picker.locator('[data-palette-delete-confirm]').click();
  check('deleting shows the next palette',(await picker.locator('[data-palette-menu]').textContent()).trim()==='Night scene');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  await primary.click();await picker.waitFor();await frame();
  await page.screenshot({path:`${output}/picker-draw-dark.png`,clip:await picker.boundingBox()});
  await page.keyboard.press('Escape');
  check('no uncaught browser errors',errors.length===0);
}catch(error){
  await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});
  console.error(errors.join('\n'));throw error;
}finally{await browser.close();}
console.log(`${checks.length} colour palette checks passed.`);
