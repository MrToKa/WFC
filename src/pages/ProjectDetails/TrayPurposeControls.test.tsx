import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddTrayPurpose, TrayPurposeNameEditor, type TrayPurposeManagement } from './TrayPurposeControls';
function setup(): TrayPurposeManagement { return { busy: false, error: null, counts: { Used: 4 }, create: vi.fn().mockResolvedValue(true), rename: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true) }; }
describe('tray purpose controls', () => {
 it('allows creation in an empty project and retains the draft when saving fails', async () => {
  const management = setup(); vi.mocked(management.create).mockResolvedValue(false);
  render(<AddTrayPurpose management={management} disabled={false} />);
  fireEvent.change(screen.getByLabelText('New tray purpose'), { target: { value: '  Custom purpose  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add purpose' }));
  await waitFor(() => expect(management.create).toHaveBeenCalledWith('Custom purpose'));
  expect(screen.getByLabelText('New tray purpose')).toHaveValue('  Custom purpose  ');
 });
 it('prevents deleting a used purpose and submits an explicit rename', async () => {
  const management = setup(); render(<TrayPurposeNameEditor name="Used" management={management} disabled={false} />);
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('Rename tray purpose Used'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(management.rename).toHaveBeenCalledWith('Used', 'Renamed'));
 });
});
