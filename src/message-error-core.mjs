/** Pure diagnostic construction, also bundled into Electron's sandboxed preload. */
export function diagnosticError(error, source, messageKey, messageParams = {}) {
  if (typeof source !== 'string') throw new TypeError(`Unknown error message: ${messageKey}`);
  messageParams = Object.fromEntries(Object.entries(messageParams).map(([name, value]) => [name, typeof value === 'number' && Number.isFinite(value) ? value : String(value)]));
  const message = source.replace(/\{([A-Za-z]\w*)\}/g, (token, name) => Object.hasOwn(messageParams, name) ? String(messageParams[name]) : token);
  Object.defineProperty(error, 'message', {value: message, configurable: true, writable: true});
  error.messageKey = messageKey;
  error.messageParams = messageParams;
  return error;
}
