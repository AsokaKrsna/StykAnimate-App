/**
 * The words of the app's dialogs (settings.mjs, hotkey-settings.mjs,
 * shortcut-sheet.mjs, app-dialogs.mjs), in English. Components ask the app's
 * localization first (sayDialog) and fall back to these, then to en.mjs, so a
 * dialog reads the same with or without a catalog that knows the keys.
 */
import english from './en.mjs';

const TEXT = Object.freeze({
  'settings.search': 'Search settings',
  'settings.searchResults': 'Settings matching “{query}”',
  'settings.noResults': 'No settings match “{query}”.',
  'settings.privacy': 'Privacy and diagnostics…',
  'settings.sendFeedback': 'Send feedback…',
  'settings.interfaceSize': 'Interface size',
  'settings.timeline': 'Timeline',
  'settings.panelLayouts': 'Panel layouts',
  'settings.resetAll': 'Reset all',
  'settings.resetAllPanels': 'Reset all panel layouts',
  'settings.navigation': 'Navigation',
  'settings.zoomGesture': 'Zoom gesture',
  'settings.zoomCtrlScroll': 'Ctrl + scroll to zoom',
  'settings.zoomScroll': 'Scroll to zoom',
  'settings.boxSelection': 'Box selection',
  'settings.boxBounds': 'Figure bounds',
  'settings.boxOrigins': 'Figure origins',
  'settings.jointHandles': 'Joint handles',
  'settings.showHandles': 'Show handles',
  'settings.showUnselected': 'Show unselected figures',
  'settings.autoSize': 'Automatic size',
  'settings.outline': 'Outline handles',
  'settings.handleRadius': 'Handle radius',
  'settings.handlePreview': 'Joint handle preview',
  'settings.handle.segment': 'Selected joint',
  'settings.handle.origin': 'Figure origin',
  'settings.handle.unselected': 'Unselected joint',
  'settings.handle.joined': 'Joined joint',
  'settings.handle.static': 'Static joint',
  'settings.overlays': 'Canvas overlays',
  'settings.virtualCamera': 'Virtual camera',
  'settings.motionPaths': 'Motion paths',
  'settings.builder': 'Figure builder',
  'settings.staticHandles': 'Static handles',
  'settings.highlightSegment': 'Highlight segment',
  'settings.construction': 'Construction background',
  'settings.constructionColor': 'Construction background color',
  'settings.graphics': 'Graphics',
  'settings.graphicsMode': 'Graphics mode',
  'settings.graphicsAuto': 'Automatic',
  'settings.keyframes': 'Keyframes',
  'settings.replaceOnDrop': 'Replace keyframes on drop',
  'settings.replaceOnDropNote': 'Dragging or Alt-dragging selected keys onto existing keys on the same layer replaces them. Turn off to block occupied destinations.',
  'settings.playback': 'Playback',
  'settings.playbackQuality': 'Playback quality',
  'settings.playbackQualityNote': 'Lower quality reduces preview resolution for smoother playback. Automatic adjusts it while playing. Editing and exports are unaffected.',
  'settings.loop': 'Loop animation',
  'settings.fitView': 'Fit view when playback starts',
  'settings.fitViewNote': 'Turn off to keep your current zoom and pan when starting playback.',
  'settings.recovery': 'Recovery',
  'settings.autosaveInterval': 'Autosave interval',
  'settings.autosaveOff': 'Off',
  'settings.seconds': '{count} seconds',
  'settings.minute': '1 minute',
  'settings.gestures': 'Pen and tablet',
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.search': 'Search shortcuts',
  'shortcuts.workspace': 'Show shortcuts for',
  'shortcuts.all': 'All',
  'shortcuts.animate': 'Animate',
  'shortcuts.draw': 'Draw',
  'shortcuts.build': 'Build',
  'shortcuts.gestures': 'Mouse and pen',
  'shortcuts.edit': 'Edit shortcuts…',
  'shortcuts.empty': 'No shortcuts match “{query}”.',
  'shortcuts.or': 'or',
  'about.title': 'About StykAnimate',
  'about.version': 'Version {version}',
  'about.web': 'Web version',
  'about.tagline': 'Stick figure animation, made simple.',
  'about.whatsNew': 'What’s new',
  'about.website': 'StykAnimate website',
  'about.support': 'Support development',
});

const fill = (text, params) => text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => (Object.hasOwn(params, name) ? String(params[name]) : token));

export default TEXT;

/** The text for `key`: t(key, params) when the localization knows it, else the English above or in en.mjs. */
export function sayDialog(t, key, params = {}) {
  if (typeof t === 'function') {
    try {
      const text = t(key, params);
      if (typeof text === 'string' && text && text !== key) return text;
    } catch { /* a missing or malformed translation falls back to English */ }
  }
  const fallback = Object.hasOwn(TEXT, key) ? TEXT[key] : Object.hasOwn(english, key) ? english[key] : key;
  return typeof fallback === 'string' ? fill(fallback, params) : key;
}
