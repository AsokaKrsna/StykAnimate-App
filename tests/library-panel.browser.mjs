import {chromium} from './support/playwright.mjs';
import assert from 'node:assert/strict';
// Library panel states with stand-ins for the desktop library and public
// library APIs: the web explanation, both sources, filtering, recovering from
// an empty search, the card and library menus, and opening a website link.
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.stack));
const check=(name,value)=>{assert.ok(value,name);console.log('PASS',name);};
const labels=async menu=>(await menu.locator('[role^="menuitem"] > span:first-of-type').allTextContents()).join('|');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEl0AAAAASUVORK5CYII=';
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47831');await page.waitForFunction(()=>styk.ready);
  await page.locator('#library-tab').click();
  check('the web build explains where the library lives',await page.getByText('Library is available in the desktop app').isVisible()&&!(await page.getByLabel('Search library').isVisible()));
  check('the web build still offers the public library',await page.getByRole('button',{name:'Public library',exact:true}).isVisible());
  await page.getByRole('button',{name:'Public library',exact:true}).click();
  check('the web build links to the public library website',await page.getByRole('link',{name:'Open stykanimate.com/library'}).getAttribute('href')==='https://stykanimate.com/library/');
  await page.getByRole('button',{name:'My library',exact:true}).click();
  await page.evaluate(async png=>{
    const entries=[{kind:'folder',name:'Characters',path:'Characters',modified:1},{kind:'figure',name:'Walker',path:'Walker.stkz',modified:1},{kind:'movieclip',name:'Punch combo',path:'Punch.stykmov',modified:1},{kind:'set',name:'Crowd',path:'Crowd.stkz',modified:1}];
    const catalog={page:'https://stykanimate.com/library/',packs:[{id:'mechanisms',name:'Mechanisms',description:'Moving parts'},{id:'shapes',name:'3D shapes',description:''}],
      items:[{id:'folding-fan',name:'Folding fan',kind:'figure',pack:'mechanisms',description:'Open the fan',size:10,sha256:'a'.repeat(64)},{id:'turbine-3d',name:'Turbine assembly',kind:'figure',pack:'mechanisms',description:'',size:10,sha256:'b'.repeat(64)},{id:'solid-box-3d',name:'Box',kind:'figure',pack:'shapes',description:'',size:10,sha256:'c'.repeat(64)}]};
    window.publicCalls=[];
    const lib=styk.library;lib.desktop={listLibrary:async folder=>({path:folder||'',root:'Library',entries:folder?[]:entries}),getLibraryThumbnail:async()=>null,
      listPublicLibrary:async refresh=>{publicCalls.push(['list',refresh]);await new Promise(r=>setTimeout(r,600));return catalog;},getPublicLibraryPreview:async id=>{publicCalls.push(['preview',id]);return png;},
      openPublicLibraryPage:async id=>publicCalls.push(['page',id]),savePublicLibraryAsset:async options=>{publicCalls.push(['save',options.id,options.folder]);return {path:'Folding fan.stkz'};}};
    await lib.refresh('');
  },png);
  const cards=page.locator('.library-card');
  check('all assets are listed with a count',await cards.count()===4&&await page.locator('.library-count').textContent()==='4 items');
  check('the cards are one listbox with a single tab stop',await page.locator('.library-grid[role="listbox"]').count()===1&&await page.locator('.library-card[tabindex="0"]').count()===1);
  check('the old action bar and footer controls are gone',await page.locator('.library-item-actions, .library-footer-row, [data-library-filter]').count()===0);
  await page.getByLabel('Show',{exact:true}).selectOption('movieclip');
  check('the Movieclips filter keeps folders and movieclips',await cards.count()===2);
  await page.getByLabel('Show',{exact:true}).selectOption('figure');
  check('the Figures filter includes figure sets',await cards.count()===3);
  await page.getByLabel('Search library').fill('zzz');
  check('an empty search explains itself',await page.getByText('No matches').isVisible());
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  check('clearing restores every asset and the All filter',await cards.count()===4&&await page.getByLabel('Search library').inputValue()===''&&await page.getByLabel('Show',{exact:true}).inputValue()==='all');
  await page.locator('[data-library-path="Walker.stkz"]').click();
  await page.mouse.move(5,5);await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-library-path="Walker.stkz"] .library-more')).opacity==='1');
  check('a click selects a card and keeps its menu button visible',await page.locator('[data-library-path="Walker.stkz"][aria-selected="true"]').count()===1);
  await page.keyboard.press('ArrowRight');
  check('arrow keys move the selection',await page.evaluate(()=>styk.library.selected)==='Punch.stykmov');
  await page.locator('[data-library-path="Walker.stkz"] .library-more').click();
  const menu=page.getByRole('menu',{name:'Library actions'});
  check('the card menu holds every card action',await menu.isVisible()&&await labels(menu)==='Insert|Rename|Move to…|Show in folder|Move to Recycle Bin');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Library options',exact:true}).click();
  const options=page.getByRole('menu',{name:'Library options'});
  check('the library menu holds folders, refresh, the preview background and examples',(await labels(options)).startsWith('New folder|Add selection|Refresh|Show in folder|Preview background')&&await options.locator('[data-action="rig-examples"]').count()===1);
  await options.getByRole('menuitem',{name:'Preview background'}).click();
  await page.getByRole('menuitemradio',{name:'Dark'}).click();
  check('the preview background override applies',await page.locator('#user-library').getAttribute('data-background')==='dark');
  check('Add selection is pinned to the foot',await page.locator('.library-foot .library-add').isVisible());
  await page.evaluate(()=>styk.library.refresh('Characters'));
  check('an empty folder offers next steps',await page.getByText('Empty folder').isVisible()&&await page.locator('.library-breadcrumbs [aria-current="location"]').textContent()==='Characters');
  await page.locator('.library-breadcrumbs button').first().click();

  await page.getByRole('button',{name:'Public library',exact:true}).click();
  check('the public library shows placeholders while it loads',await page.locator('.library-card.is-skeleton').count()>0);
  await page.locator('[data-public-id="folding-fan"] img').waitFor();
  check('public assets are grouped by pack with a count',(await page.locator('.library-group-label > span:first-child').allTextContents()).join('|')==='Mechanisms|3D shapes'&&await page.locator('.library-count').textContent()==='3 assets');
  check('the public foot links to the website instead of Add selection',await page.locator('.library-foot .library-website').isVisible()&&!(await page.locator('.library-foot .library-add').isVisible()));
  await page.getByLabel('Search library').fill('box');
  check('search covers the public library',await page.locator('.library-card').count()===1);
  await page.getByLabel('Search library').fill('');
  await page.locator('[data-public-id="folding-fan"]').click({button:'right'});
  check('a public card offers Insert, Save to My library and the website',await labels(menu)==='Insert|Save to My library|View on stykanimate.com');
  await menu.getByRole('menuitem',{name:'Save to My library'}).click();
  await page.waitForFunction(()=>publicCalls.some(call=>call[0]==='save'));
  check('saving a public asset targets My library and reports it',await page.locator('.library-message').textContent()==='Folding fan saved to My library');
  await page.getByRole('button',{name:'My library',exact:true}).click();
  await page.evaluate(()=>styk.library.openPublic('solid-box-3d'));
  check('a website link opens the public asset selected and focused',await page.evaluate(()=>styk.library.source==='public'&&styk.library.publicSelected==='solid-box-3d'&&document.activeElement?.dataset.publicId==='solid-box-3d'));
  check('returning to the public library asks again without placeholders (the main process caches it)',(await page.evaluate(()=>publicCalls.filter(call=>call[0]==='list').length))===2);
  check('the Library has no horizontal overflow',await page.locator('#user-library').evaluate(node=>node.scrollWidth<=node.clientWidth));
  await page.screenshot({path:'artifacts/library-panel-public.png'});
  check('no uncaught browser errors',!errors.length);
}finally{await browser.close();}
if(errors.length)console.error(errors.join('\n'));
