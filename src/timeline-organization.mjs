/** View-only layer projection. Never changes document order or visibility. */
export function organizeTimelineRows(rows, query = '', focusedIds = null) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => row.kind !== 'layer' ||
    ((!focusedIds || focusedIds.has(row.id)) && terms.every(term => row.name.toLocaleLowerCase().includes(term))));
}

export const timelineOrganizationMethods = {
  setLayerFilter(query = '', focusedIds = this.focusedLayerIds) {
    this._cancelGesture();
    this.layerQuery = query;
    this.focusedLayerIds = focusedIds;
    this.layerSearch.value = query;
    this.anchor = this.hover = null;
    this._reindex();
    const visible = new Set(this.tracks.map(row => row.id));
    this.selectedLayers = new Set([...this.selectedLayers].filter(id => visible.has(id)));
    if (!visible.has(this.selectedTrackId)) this.selectedTrackId = this.tracks.find(row => row.kind === 'layer')?.id ?? 'camera';
    if (!this.selectedLayers.size) this.selectedLayers.add(this.selectedTrackId);
    this.scroll.scrollTop = 0;
    this.update();
  },
  focusSelectedLayers() {
    const ids = new Set(this.ids.filter(id => this.editor.getLayer(id)?.kind === 'layer'));
    if (!this.focusedLayerIds && !ids.size) { this.live.textContent = 'Select a figure layer to focus.'; return; }
    this.setLayerFilter(this.layerQuery, this.focusedLayerIds ? null : ids);
  },
  revealSelectedLayer() {
    if (!this.tracks.some(row => row.id === this.selectedTrackId)) {
      const id = this.selectedTrackId;this.setLayerFilter('', null);this.selectedTrackId = id;this.selectedLayers = new Set([id]);
    }
    const index = this.tracks.findIndex(row => row.id === this.selectedTrackId), layout = this.layout;
    if (index < 0 || !layout || layout.pinned && index < layout.system) return;
    // The scrolling rows show between the pinned block (or the ruler) and the grid's foot (timeline-rows.mjs).
    const top = layout.top(index), bottom = top + layout.size(index), offset = this._offsetY();
    const above = layout.contentTop - layout.header, view = this.height - layout.header;
    if (top < offset + above) this._scrollToY(top - above);
    else if (bottom > offset + view) this._scrollToY(bottom - view);
  },
  fitFrameRange(selection = false) {
    const start = selection ? this.start : 0;
    const end = selection ? this.end + 1 : this.editor.totalTicks;
    this.setZoom(Math.min(36, (this.width - 32) / Math.max(1, end - start)));
    this._scrollToX(Math.max(0, start * this.pxPerTick - 16));
  },
  _syncOrganization() {
    const count = this.visibleLayerCount;
    const total = this.editor.report._styk.layers.order.length;
    const title=`${count} of ${total} layers`,hidden=!this.layerQuery,focused=String(Boolean(this.focusedLayerIds));
    if(this.layerSearch.title!==title)this.layerSearch.title=title;
    if(this.clearSearch.hidden!==hidden)this.clearSearch.hidden=hidden;
    if(this.focusLayersButton.getAttribute('aria-pressed')!==focused)this.focusLayersButton.setAttribute('aria-pressed',focused);
    const focusName=this.focusedLayerIds?'Show all layers':'Focus selected layers',focusWord=this.focusedLayerIds?'Show all':'Focus';
    if(this.focusLayersButton.getAttribute('aria-label')!==focusName)this.focusLayersButton.setAttribute('aria-label',focusName);
    const word=this.focusLayersButton.querySelector('.ui-label');if(word&&word.textContent!==focusWord)word.textContent=focusWord;
    // The layer list's header: Show all while a focus is on (a layer's menu focuses it), New layer's kind
    // for the workspace (Draw makes drawing layers), and the find field in the title's place while it is used.
    const focusHidden=!this.focusedLayerIds;
    if(this.focusLayersButton.hidden!==focusHidden)this.focusLayersButton.hidden=focusHidden;
    if(this.newLayerButton){const label=this._drawWorkspace?.()?'New drawing layer':'New layer';if(this.newLayerButton.getAttribute('aria-label')!==label)this.newLayerButton.setAttribute('aria-label',label);}
    if(this.searchField){const open=Boolean(this.layerQuery)||document.activeElement===this.layerSearch;if(this.searchField.hidden!==!open)this.searchField.hidden=!open;if(this.labelTitle.hidden!==open)this.labelTitle.hidden=open;}
    const emptyHidden=count>0||!(this.layerQuery||this.focusedLayerIds);
    if(this.emptyLayers.hidden!==emptyHidden)this.emptyLayers.hidden=emptyHidden;
    const frames = this.end - this.start + 1;
    const text = `${this.ids.length} ${this.ids.length === 1 ? 'layer' : 'layers'} · ${frames === 1 ? `Frame ${this.start + 1}` : `${this.start + 1}–${this.end + 1} · ${frames} frames`}`;
    if (this.selectionSummary && this.selectionSummary.textContent !== text) this.selectionSummary.textContent = text;
  },
};
