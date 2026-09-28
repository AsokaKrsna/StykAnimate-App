import {parseReleaseNotes} from './release-notes.mjs';
export const DONATE_URL = 'https://ko-fi.com/Q5Q41WY7QC';

export class ReleaseSplash {
  constructor(desktop) { this.desktop = desktop; }
  /** The notes to offer once at startup (a version not seen yet), or null. The app's startup prompt queue shows them. */
  async startupInfo() { return this.desktop?.getReleaseInfo ? this.desktop.getReleaseInfo(true) : null; }
  /** Shows the notes: `info` from startupInfo(), else the installed version's. Resolves once shown. */
  async open({ startup = false, info: given = null } = {}) {
    if (!this.desktop?.getReleaseInfo || this.opening) return;
    if (this.dialog?.open) { this.dialog.focus(); return; }
    this.opening = true;
    try {
      const info = given ?? await this.desktop.getReleaseInfo(startup);
      if (!info) return;
      this.dialog?.remove();
      const modal = this.dialog = document.createElement('dialog');
      modal.className = 'release-splash';
      modal.setAttribute('aria-labelledby', 'release-splash-title');
      modal.innerHTML = `<header class="splash-header"><div class="splash-brand"><img src="./symbol.svg" width="26" height="26" alt=""><span class="splash-wordmark">StykAnimate</span></div><button class="splash-close" aria-label="Close welcome screen" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></header><div class="splash-toolbar"><p class="splash-version"></p><h1 id="release-splash-title">What’s new in <span>StykAnimate.</span></h1><div class="splash-release-controls"><select aria-label="Release version"></select><button class="splash-history" type="button">Recent releases</button></div><p class="splash-status" role="status" hidden></p></div><section class="splash-notes" aria-label="Release notes" tabindex="0"></section><footer class="splash-footer"><a class="support-donate" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.6 1.2 5.2 3 1.6-1.8 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>Support on Ko-fi</a><button class="button" type="button" autofocus>Start animating <span aria-hidden="true">→</span></button></footer>`;
      modal.querySelector('.splash-version').textContent = `Version ${info.version} installed`;
      const selector = modal.querySelector('select'), body = modal.querySelector('.splash-notes'), status = modal.querySelector('.splash-status');
      const releases = new Map([[info.version,info]]);
      const showStatus = text => {status.textContent=text;status.hidden=!text;};
      const render = () => {
        const release = releases.get(selector.value);
        body.replaceChildren();
        const head=document.createElement('div'),version=document.createElement('span'),title=document.createElement('h2');
        head.className='splash-release-head';version.className='splash-release-version';version.textContent=release.version;head.append(version);
        if (release.version===info.version) {const installed=document.createElement('span');installed.className='splash-release-installed';installed.textContent='Installed';head.append(installed);}
        title.className='splash-release-title';title.textContent=release.title||`StykAnimate ${release.version}`;body.append(head,title);
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
