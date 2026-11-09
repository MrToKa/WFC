import { describe, expect, it } from 'vitest';
import { trayIdentityErrorMessage } from './trayIdentityErrors';

describe('tray identity error instructions', () => {
  it.each(['TRAY_IDENTITY_ROW_LIMIT', 'TRAY_IDENTITY_READ_FAILED', 'TRAY_IDENTITY_TIMEOUT',
    'TRAY_IDENTITY_INDEX_LIMIT', 'TRAY_IDENTITY_SCOPE_INVALID', 'TRAY_IDENTITY_RESULT_INVALID'])(
    'keeps %s local to recognition and explains the recovery action', code => {
      const message = trayIdentityErrorMessage(code);
      expect(message).toContain('model remains loaded');
      expect(message).toContain('Saved assignments and the published network were kept');
      expect(message).toContain('Discover project tray candidates');
      expect(message).not.toContain('Refresh Path Finder');
      expect(message).not.toContain(code);
    });
  it('does not treat arbitrary error text or object properties as instructions', () => {
    for (const input of ['Private SDK path', 'TRAY_IDENTITY_ROW_LIMIT\nprivate', 'toString', '__proto__',
      { code: 'TRAY_IDENTITY_ROW_LIMIT', message: 'private' }, null, undefined])
      expect(trayIdentityErrorMessage(input)).toBeNull();
  });
});
