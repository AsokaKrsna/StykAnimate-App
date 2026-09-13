/** Workspace presentation only. Never changes scene zoom or document data. */
export const UI_SCALE = Object.freeze({min: 75, max: 200, step: 5, default: 100});

export function normalizeUIScale(value) {
  if (!Number.isFinite(value)) return UI_SCALE.default;
  return Math.max(UI_SCALE.min, Math.min(UI_SCALE.max, Math.round(value / UI_SCALE.step) * UI_SCALE.step));
}

export function applyUIScale(value, desktop = globalThis.window?.stykDesktop) {
  const percent = normalizeUIScale(value);
  desktop?.setUIScale?.(percent);
  return percent;
}
