/**
 * Text for the overlay kit's own words (Close, OK, Dismiss, "In Build", the
 * palette's group names, …). Components take a `t(key, params)` function (the
 * app's localization.t); a key it does not know falls back to the English
 * text in en-overlays.mjs, or in en.mjs for the existing keys the kit reuses,
 * so the kit reads the same with or without a localization.
 */
import english from '../locales/en.mjs';
import overlays from '../locales/en-overlays.mjs';

const fill = (text, params) => text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) => (Object.hasOwn(params, name) ? String(params[name]) : token));

/** The text for `key`: t(key, params) when it knows the key, else the English fallback. */
export function kitText(t, key, params = {}) {
  if (typeof t === 'function') {
    try {
      const text = t(key, params);
      if (typeof text === 'string' && text && text !== key) return text;
    } catch { /* a missing or malformed translation falls back to English */ }
  }
  const fallback = Object.hasOwn(overlays, key) ? overlays[key] : Object.hasOwn(english, key) ? english[key] : key;
  return typeof fallback === 'string' ? fill(fallback, params) : key;
}

/** `t` from a localization object ({t(key, params)}) or a function; null when neither. */
export function translator(localization) {
  if (typeof localization === 'function') return localization;
  if (typeof localization?.t === 'function') return (key, params) => localization.t(key, params);
  return null;
}
