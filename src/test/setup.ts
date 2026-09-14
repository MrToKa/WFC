import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { transferableAbortController } from 'node:util';

// React Router uses Node's Request in jsdom. Keep its signal in the same realm.
if (typeof window !== 'undefined') {
  const controller = transferableAbortController();
  globalThis.AbortController = controller.constructor as typeof AbortController;
  globalThis.AbortSignal = controller.signal.constructor as typeof AbortSignal;
}

afterEach(() => {
  cleanup();
});
