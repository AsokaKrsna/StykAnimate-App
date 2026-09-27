// Runs before styles and the app's module graph to avoid a light startup flash.
// Keep this cache key in sync with THEME_CACHE_KEY in theme.mjs.
(() => {
  const resolveTheme = value => value === 'light' || value === 'dark'
    ? value : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  let theme = resolveTheme('system');
  try {
    const saved = localStorage.getItem('stykanimate.theme.v1');
    const value = saved ?? JSON.parse(localStorage.getItem('stykanimate.editor.settings.v1') || 'null')?.theme;
    theme = resolveTheme(value);
  } catch { /* Follow the system when stored preferences cannot be read. */ }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0b0f' : '#eceff4');
  // Desktop backend ports change between runs. Read the native preference now,
  // before the large app module graph loads, rather than relying on origin storage.
  if (window.stykDesktop?.getEditorSettings) {
    document.documentElement.dataset.themePending = '';
    window.stykInitialEditorSettings = Promise.resolve()
      .then(() => window.stykDesktop.getEditorSettings())
      .then(settings => {
        const nativeTheme = resolveTheme(settings?.theme);
        document.documentElement.dataset.theme = nativeTheme;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nativeTheme === 'dark' ? '#0a0b0f' : '#eceff4');
        return settings;
      })
      .catch(() => undefined)
      .finally(() => { delete document.documentElement.dataset.themePending; });
  }
})();
