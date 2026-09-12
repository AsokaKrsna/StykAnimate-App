/** Select an editable format through the visible export flow. */
export async function exportEditable(page, format) {
  await page.locator('[data-category="editable"]').click();
  await page.locator('#output-format').selectOption(`export-${format}`);
  await page.locator('#export-submit').click();
}
