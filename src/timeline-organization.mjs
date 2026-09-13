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
    const index = this.tracks.findIndex(row => row.id === this.selectedTrackId);
    if (index < 0) return;
    const top = index * 32, bottom = top + 32, offset = this._offsetY();
    if (top < offset) this._scrollToY(top);
    else if (bottom > offset + this.height - 32) this._scrollToY(bottom - this.height + 32);
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
    this.layerSearch.title = `${count} of ${total} layers`;
    this.clearSearch.hidden = !this.layerQuery;
    this.focusLayersButton.setAttribute('aria-pressed', String(Boolean(this.focusedLayerIds)));
    this.focusLayersButton.title = this.focusedLayerIds ? 'Show all layers' : 'Focus selected layers';
    this.emptyLayers.hidden = count > 0 || !(this.layerQuery || this.focusedLayerIds);
    const frames = this.end - this.start + 1;
    const text = `${this.ids.length} ${this.ids.length === 1 ? 'layer' : 'layers'} · ${frames === 1 ? `Frame ${this.start + 1}` : `${this.start + 1}–${this.end + 1} · ${frames} frames`}`;
    if (this.selectionSummary && this.selectionSummary.textContent !== text) this.selectionSummary.textContent = text;
  },
};
