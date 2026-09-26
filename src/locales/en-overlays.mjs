/**
 * English strings of the overlay kit (src/ui/): dialogs, toasts, the command
 * palette and the command metadata that no existing key covers. Controls that
 * already have a key keep it (common.close, common.cancel, menu.file, …) so
 * the native Pivot catalogs keep translating them; add a key here only for
 * text that has none.
 *
 * en.mjs spreads this fragment once the kit is wired into the app; until then
 * the kit falls back to these texts itself (src/ui/ui-strings.mjs).
 */
export default Object.freeze({
  'overlays.ok': 'OK',
  'overlays.dismiss': 'Dismiss',
  'overlays.closeDialog': 'Close dialog',
  // A command that belongs to another workspace: "In Build".
  'overlays.inMode': 'In {mode}',
  'overlays.mode.animate': 'Animate',
  'overlays.mode.draw': 'Draw',
  'overlays.mode.rig': 'Build',
  // Command categories without an existing menu key.
  'overlays.category.animation': 'Animation',
  'overlays.category.figure': 'Figure',
  'overlays.category.build': 'Build',
  'overlays.category.camera': 'Camera',
  'overlays.category.tools': 'Tools',
  'overlays.category.drawing': 'Drawing',
  'overlays.category.canvas': 'Canvas',
  'overlays.category.export': 'Export',
  'overlays.category.app': 'Application',
  // Command palette
  'overlays.palette.open': 'Search commands…',
  'overlays.palette.label': 'Command palette',
  'overlays.palette.placeholder': 'Search commands',
  'overlays.palette.empty': 'No results',
  'overlays.palette.recent': 'Recent',
  'overlays.palette.commands': 'Commands',
  'overlays.palette.goTo': 'Go to',
  'overlays.palette.goToFrame': 'Go to frame {frame}',
});
