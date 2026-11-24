// Shared by the e2e specs that answer the app's own dialogs.

/**
 * Answers the in-app dialog (#732): types `text` into its field when given, presses its confirm button and
 * returns the dialog's text.
 */
export async function answerDialog(page, text) {
  const d = page.locator('dialog[data-app-dialog][open]');
  await d.waitFor();
  const message = await d.innerText();
  if (text !== undefined) await d.getByRole('textbox').fill(text);
  await d.locator('button[value="ok"]').click();
  await d.waitFor({ state: 'detached' });
  return message;
}
