const saved = 'The model remains loaded. Saved assignments and the published network were kept.';
const retry = 'Choose Generate network or Regenerate network to retry.';
const messages: Readonly<Record<string, string>> = Object.freeze({
  TRAY_IDENTITY_ROW_LIMIT: `Automatic tray recognition reached the property limit for some model objects. ${saved} ${retry} You can also confirm unresolved trays with Use current model selection.`,
  TRAY_IDENTITY_READ_FAILED: `Automatic tray recognition could not read the saved tray objects in this model revision. ${saved} ${retry}`,
  TRAY_IDENTITY_TIMEOUT: `Checking the saved tray objects took too long. ${saved} ${retry}`,
  TRAY_IDENTITY_INDEX_LIMIT: `Automatic tray recognition reached the supported model size limit. ${saved} Use current model selection to confirm unresolved trays, then choose Generate network or Regenerate network again.`,
  TRAY_IDENTITY_SCOPE_INVALID: `The saved tray objects could not be checked for the current model. ${saved} Confirm the affected tray assignments with Use current model selection, then choose Generate network or Regenerate network.`,
  TRAY_IDENTITY_RESULT_INVALID: `Automatic tray recognition did not return a usable result. ${saved} ${retry}`,
});

/** Presentation is selected only by closed error codes, never SDK error text. */
export function trayIdentityErrorMessage(code: unknown): string | null {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : null;
}
