import { describe, expect, it } from 'vitest';
import { parseFormErrors } from './formErrors';

describe('parseFormErrors', () => {
  it('keeps field validation and form errors visible together', () => {
    expect(
      parseFormErrors(
        {
          fieldErrors: { email: ['Invalid email'], password: [] },
          formErrors: ['Unable to save'],
        },
        ['email', 'password'],
      ),
    ).toEqual({ email: 'Invalid email', general: 'Unable to save' });
  });

  it('shows errors for fields outside the current form as general errors', () => {
    expect(
      parseFormErrors({ fieldErrors: { account: ['Account is unavailable'] } }, ['email']),
    ).toEqual({ general: 'Account is unavailable' });
  });

  it.each(['', {}, { fieldErrors: { email: [] }, formErrors: [' '] }])(
    'provides a visible fallback when the server error has no message: %j',
    (payload) => {
      expect(parseFormErrors(payload, ['email'])).toEqual({
        general: 'Request failed. Please try again.',
      });
    },
  );
});
