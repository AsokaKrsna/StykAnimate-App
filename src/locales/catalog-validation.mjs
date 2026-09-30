/** Pure validation shared by generation, CI and translator tooling. */
export const placeholders = text => [...new Set([...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();
const categories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const own = (object, key) => Object.hasOwn(object, key);

export function validateCatalog({ locale, messages }, english) {
  const errors = [], missing = [], incompletePlurals = [];
  const fail = (key, reason) => errors.push(`${key}: ${reason}`);
  let forms = ['other'];
  try {
    if (!locale || Intl.getCanonicalLocales(locale.id)[0] !== locale.id) throw Error();
    forms = new Intl.PluralRules(locale.id).resolvedOptions().pluralCategories;
    if (!['ltr', 'rtl'].includes(locale.direction) || !locale.name || !locale.nativeName) throw Error();
    for (const alias of locale.aliases ?? []) if (Intl.getCanonicalLocales(alias)[0] !== alias) throw Error();
  } catch { fail('locale', 'invalid ID, metadata or aliases'); }
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) return { errors: [...errors, 'messages: expected an object'], missing, incompletePlurals };
  const checkText = (key, text, expected) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 16384 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) { fail(key, 'invalid plain text'); return; }
    if (/[{}]/.test(text.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, ''))) fail(key, 'malformed named placeholder');
    if (/<\/?[A-Za-z][^>]*>/.test(text)) fail(key, 'markup is not allowed');
    if (expected && JSON.stringify(placeholders(text)) !== JSON.stringify(expected)) fail(key, 'placeholders differ from English');
  };
  for (const [key, message] of Object.entries(messages)) {
    if (!/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(key) || !own(english, key)) { fail(key, 'unknown key'); continue; }
    const source = english[key];
    if (typeof source === 'string') checkText(key, message, placeholders(source));
    else {
      if (!message || typeof message !== 'object' || Array.isArray(message) || !own(message, 'other')) { fail(key, 'plural message requires other'); continue; }
      for (const [category, text] of Object.entries(message)) {
        if (!categories.has(category)) fail(key, `unknown plural form ${category}`);
        checkText(`${key}.${category}`, text, placeholders(source.other));
      }
      const absent = forms.filter(form => !own(message, form));
      if (absent.length) incompletePlurals.push({key, forms: absent});
    }
  }
  for (const key of Object.keys(english)) if (!own(messages, key)) missing.push(key);
  return { errors, missing, incompletePlurals };
}
