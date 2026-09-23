import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Library panel states with a stand-in for the desktop library API: the web
// explanation, segmented filtering, and recovering from an empty search.
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.stack));
const check=(name,value)=>{assert.ok(value,name);console.log('PASS',name);};
try{
  await page.goto(process.env.STYK_URL||'http://127.0.0.1:47831');await page.waitForFunction(()=>styk.ready);
  await page.locator('#library-tab').click();
  check('the web build explains where the library lives',await page.getByText('Library is available in the desktop app').isVisible()&&!(await page.getByLabel('Search library').isVisible()));
  await page.evaluate(async()=>{
    const entries=[{kind:'folder',name:'Characters',path:'Characters',modified:1},{kind:'figure',name:'Walker',path:'Walker.stkz',modified:1},{kind:'movieclip',name:'Punch combo',path:'Punch.stykmov',modified:1},{kind:'set',name:'Crowd',path:'Crowd.stkz',modified:1}];
    const lib=styk.library;lib.desktop={listLibrary:async folder=>({path:folder||'',root:'Library',entries:folder?[]:entries}),getLibraryThumbnail:async()=>null};
    delete lib.container.dataset.unavailable;await lib.refresh('');
  });
  const cards=page.locator('.library-card');
  check('all assets are listed with a count',await cards.count()===4&&await page.locator('.library-count').textContent()==='4 items');
  await page.getByRole('button',{name:'Movieclips',exact:true}).click();
  check('the Movieclips filter keeps folders and movieclips',await cards.count()===2&&await page.locator('[data-library-filter="movieclip"][aria-pressed="true"]').count()===1);
  await page.getByRole('button',{name:'Figures',exact:true}).click();
  check('the Figures filter includes figure sets',await cards.count()===3);
  await page.getByLabel('Search library').fill('zzz');
  check('an empty search explains itself',await page.getByText('No matches').isVisible());
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  check('clearing restores every asset and the All filter',await cards.count()===4&&await page.getByLabel('Search library').inputValue()===''&&await page.locator('[data-library-filter="all"][aria-pressed="true"]').count()===1);
  await page.evaluate(()=>styk.library.refresh('Characters'));
  check('an empty folder offers next steps',await page.getByText('Empty folder').isVisible()&&await page.locator('.library-empty').getByRole('button',{name:'Rig examples',exact:true}).isVisible());
  check('no uncaught browser errors',!errors.length);
}finally{await browser.close();}
if(errors.length)console.error(errors.join('\n'));
