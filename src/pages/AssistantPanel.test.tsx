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


it('sends a page request without a project selector', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ answer: 'Catalog information' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  try {
    render(<AssistantPanel page="/materials" initiallyOpen />);
    expect(screen.queryByText('Choose a project')).toBeNull();
    const field = await screen.findByRole('textbox', { name: 'Message to AI Assistant' });
    fireEvent.change(field, { target: { value: 'Explain ordering units' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Catalog information')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/assistant/page'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'Explain ordering units', page: '/materials' }),
      }),
    );
  } finally {
    fetchMock.mockRestore();
  }
});