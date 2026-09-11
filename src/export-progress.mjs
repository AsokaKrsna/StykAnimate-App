/** Presentation state only. Frame completion is reported by the renderer/encoder;
 * elapsed time never advances the progress bar. GIF has two explicit passes. */
export class ExportProgress {
  constructor({frames = 1, passes = 1, start = 0, now = () => performance.now()} = {}) {
    Object.assign(this, {frames, passes, start, now, started: now(), phase: 'preparing', rendered: 0, completed: 0, active: 0});
  }
  frameStarted(tick) {
    this.active = this.rendered;
    this.tick = tick ?? this.start;
    this.phase = this.passes === 2 && this.rendered < this.frames ? 'palette' : 'rendering';
  }
  frameRendered() { this.rendered++; this.phase = 'processing'; }
  update({completed, phase} = {}) {
    if (Number.isFinite(completed)) this.completed = Math.max(this.completed, Math.min(this.frames * this.passes, completed));
    if (this.completed === this.frames * this.passes) this.phase = 'encoding';
    if (['encoding', 'complete', 'saving'].includes(phase)) this.phase = phase === 'complete' ? 'encoding' : phase;
  }
  snapshot() {
    const work = this.frames * this.passes;
    const pass = Math.min(this.passes, Math.floor(this.active / this.frames) + 1);
    const rendered = Math.min(this.frames, Math.max(0, this.rendered - (pass - 1) * this.frames));
    const elapsed = Math.max(0, (this.now() - this.started) / 1000);
    const done = this.completed;
    const rate = elapsed >= 1 && done > 0 ? done / elapsed : null;
    const finalizing = ['encoding', 'saving'].includes(this.phase);
    return {phase: this.phase, pass, passes: this.passes, rendered, remaining: this.frames - rendered,
      frames: this.frames, frame: Math.min(this.frames, this.active % this.frames + 1), sourceFrame: (this.tick ?? this.start) + 1,
      elapsed, rate, eta: rate && done >= 3 && done < work ? (work - done) / rate : null,
      // Reserve the final portion for container finalization and the actual save.
      percent: this.phase === 'saving' ? 98 : finalizing ? 95 : Math.min(95, Math.floor(done / work * 95))};
  }
}

export function exportTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`;
}

export const exportProgressMarkup = `<div class="export-progress-view">
  <div class="export-progress-heading"><strong id="export-stage" role="status" aria-live="polite">Preparing animation…</strong><output id="export-percent">0%</output></div>
  <progress id="export-progress" max="100" aria-label="Export progress" aria-describedby="export-frame-detail"></progress>
  <p id="export-frame-detail"></p>
  <dl class="export-progress-stats"><div><dt>Rendered</dt><dd id="export-rendered">0</dd></div><div><dt>Left to render</dt><dd id="export-remaining">—</dd></div><div><dt>Elapsed</dt><dd id="export-elapsed">0s</dd></div><div><dt>Est. remaining</dt><dd id="export-eta">—</dd></div></dl>
  <p id="export-pass-note" hidden></p>
  <div class="export-flow-footer"><button class="button" id="cancel-export">Cancel export</button></div>
</div>`;

export function mountExportProgress(content, options, cancel) {
  const model = new ExportProgress(options), dialog = content.closest('dialog');
  dialog.classList.remove('studio-export-dialog'); dialog.classList.add('export-progress-dialog');
  const field = id => content.querySelector(`#export-${id}`);
  const paint = () => {
    if (!field('progress')?.isConnected) return;
    const s = model.snapshot(), preparing = s.phase === 'preparing';
    const title = s.phase === 'saving' ? 'Saving your file…' : s.phase === 'encoding' ? 'Finishing your file…'
      : preparing ? 'Preparing animation…' : s.pass === 1 && s.passes === 2 ? 'Building GIF colors…'
      : s.phase === 'processing' ? 'Encoding frames…' : 'Rendering frames…';
    if (field('stage').textContent !== title) field('stage').textContent = title;
    if (preparing) field('progress').removeAttribute('value'); else field('progress').value = s.percent;
    field('percent').textContent = preparing ? '—' : `${s.percent}%`;
    field('frame-detail').textContent = preparing ? `${s.frames.toLocaleString()} frames to export`
      : s.phase === 'saving' ? 'Choose where to save.'
      : s.phase === 'encoding' ? 'All frames rendered.'
      : `${s.phase === 'processing' ? 'Processing' : 'Rendering'} frame ${s.frame.toLocaleString()} of ${s.frames.toLocaleString()} · Animation frame ${s.sourceFrame.toLocaleString()}`;
    field('rendered').textContent = `${s.rendered.toLocaleString()} / ${s.frames.toLocaleString()}`;
    field('remaining').textContent = s.remaining.toLocaleString();
    field('elapsed').textContent = exportTime(s.elapsed);
    field('eta').textContent = s.eta === null ? '—' : `~${exportTime(s.eta)}`;
    field('pass-note').hidden = s.passes !== 2;
    field('pass-note').textContent = s.passes === 2 ? `Pass ${s.pass} of 2` : '';
  };
  const button = content.querySelector('#cancel-export');
  button.onclick = () => { button.disabled = true; button.textContent = 'Cancelling…'; cancel(); };
  paint(); const timer = setInterval(paint, 250);
  return {
    frameStarted(tick) {model.frameStarted(tick); paint();},
    frameRendered() {model.frameRendered(); paint();},
    update(value) {model.update(value); paint();},
    dispose() {clearInterval(timer); dialog.classList.remove('export-progress-dialog');},
  };
}
