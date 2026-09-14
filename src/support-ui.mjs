import {parseReleaseNotes} from './release-notes.mjs';
export const DONATE_URL = 'https://ko-fi.com/Q5Q41WY7QC';

export function supportCard({ compact = false, desktop = globalThis.stykDesktop } = {}) {
  const card = document.createElement('section');
  card.className = `support-card${compact ? ' support-card-compact' : ''}`;
  card.setAttribute('aria-label', 'Support StykAnimate');
  card.innerHTML = `<div><strong>Free to create. Powered by your support.</strong><p>StykAnimate is completely free. If it helps bring your ideas to life, a donation helps keep development moving.</p></div><a class="support-donate" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♥</span> Donate on Ko-fi <span aria-hidden="true">↗</span></a>`;
  card.querySelector('a').addEventListener('click', async event => {
    if (!desktop?.openDonate) return;
    event.preventDefault();
    try { await desktop.openDonate(); }
    catch { card.querySelector('p').textContent = `Open ${DONATE_URL} in your browser to support development.`; }
  });
  return card;
}

export class ReleaseSplash {
  constructor(desktop) { this.desktop = desktop; }
  async open({ startup = false } = {}) {
    if (!this.desktop?.getReleaseInfo || this.opening) return;
    if (this.dialog?.open) { this.dialog.focus(); return; }
    this.opening = true;
    try {
      const info = await this.desktop.getReleaseInfo(startup);
      if (!info) return;
      // Startup dialogs are queued so they never hide file/recovery/privacy prompts.
      if (startup && document.querySelector('dialog[open]')) {
        await new Promise(resolve => {
          const closed = () => { if (!document.querySelector('dialog[open]')) { document.removeEventListener('close', closed, true); resolve(); } };
          document.addEventListener('close', closed, true);
        });
      }
      this.dialog?.remove();
      const modal = this.dialog = document.createElement('dialog');
      modal.className = 'release-splash';
      modal.setAttribute('aria-labelledby', 'release-splash-title');
      modal.innerHTML = `<header class="splash-header"><div class="splash-brand"><img src="./symbol.svg" width="28" height="28" alt=""><span class="splash-wordmark">StykAnimate</span></div><a class="support-donate" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♥</span> Donate <span aria-hidden="true">↗</span></a><button class="splash-close" aria-label="Close welcome screen" type="button">×</button></header><div class="splash-toolbar"><h1 id="release-splash-title">What’s new</h1><div class="splash-release-controls"><select aria-label="Release version"></select><button class="splash-history" type="button">Recent releases</button></div><p class="splash-status" role="status" hidden></p></div><section class="splash-notes" aria-label="Release notes" tabindex="0"></section><footer class="splash-footer"><span class="splash-version"></span><button class="button" type="button" autofocus>Start animating <span aria-hidden="true">→</span></button></footer>`;
      modal.querySelector('.splash-version').textContent = `Version ${info.version}`;
      const selector = modal.querySelector('select'), body = modal.querySelector('.splash-notes'), status = modal.querySelector('.splash-status');
      const releases = new Map([[info.version,info]]);
      const showStatus = text => {status.textContent=text;status.hidden=!text;};
      const render = () => {
        const release = releases.get(selector.value);
        body.replaceChildren();
        const title=document.createElement('h2');title.className='splash-release-title';title.textContent=release.title||`StykAnimate ${release.version}`;body.append(title);
        const groups=release.groups?.length?release.groups:[{name:'Changes',notes:release.notes||[]}];
        for (const group of groups) {
          if (!group.notes.length) continue;
          const section=document.createElement('section'), heading=document.createElement('h3'), list=document.createElement('ul');
          section.className='splash-note-group';heading.textContent=group.name;heading.dataset.category=group.name.toLowerCase();
          for (const note of group.notes) {const item=document.createElement('li');item.textContent=note;list.append(item);}
          section.append(heading,list);body.append(section);
        }
        if (!groups.some(group=>group.notes.length)) {const empty=document.createElement('p');empty.textContent='No release notes available.';body.append(empty);}
        body.scrollTop=0;
      };
      const options = () => {
        const selected=selector.value||info.version;selector.replaceChildren();
        for (const version of [...releases.keys()].sort((a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];})) {
          const option=document.createElement('option');option.value=version;option.textContent=`${version}${version===info.version?' · Installed':''}`;selector.append(option);
        }
        selector.value=selected;
      };
      options();render();selector.onchange=render;
      const history=modal.querySelector('.splash-history');
      history.hidden=!this.desktop.getReleaseHistory;
      history.onclick=async()=>{
        history.disabled=true;history.textContent='Loading…';showStatus('');
        try {
          const recent=await this.desktop.getReleaseHistory();
          if(this.dialog!==modal||!modal.open)return;
          for(const release of recent)if(release.version!==info.version)releases.set(release.version,{version:release.version,...parseReleaseNotes(release.markdown)});
          options();history.textContent='Refresh';selector.focus();
        } catch {if(modal.open){showStatus('Couldn’t load releases. Try again.');history.textContent='Retry';}}
        finally {history.disabled=false;}
      };
      modal.querySelector('.support-donate').onclick=async event=>{
        if(!this.desktop.openDonate)return;
        event.preventDefault();try{await this.desktop.openDonate();}catch{showStatus('Couldn’t open Ko-fi. Try again.');}
      };
      modal.querySelector('.splash-close').onclick = () => modal.close();
      modal.querySelector('footer button').onclick = () => modal.close();
      document.body.append(modal);
      modal.showModal();
    } finally { this.opening = false; }
  }
}
