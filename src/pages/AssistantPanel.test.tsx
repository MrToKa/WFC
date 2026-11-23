import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AssistantPanel } from './AssistantPanel';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'engineer', role: 'engineer' }, token: 'session' }),
}));
vi.mock('./Assistant', () => ({ AssistantWorkspace: () => <textarea aria-label="draft" /> }));
it('loads on demand and preserves a draft when collapsed and reopened', async () => {
  render(<AssistantPanel projectId="project" writable />);
  const button = screen.getByRole('button', { name: 'AI Assistant' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByLabelText('draft')).toBeNull();
  fireEvent.click(button);
  const draft = await screen.findByLabelText('draft');
  fireEvent.change(draft, { target: { value: 'GVL244' } });
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(screen.getByLabelText('draft')).toHaveValue('GVL244');
});
