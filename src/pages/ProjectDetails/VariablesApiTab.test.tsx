import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectDetailsStyles } from '../ProjectDetails.styles';
import { VariablesApiTab } from './VariablesApiTab';
import { getProjectPlaceholders, setProjectPlaceholders } from '@/utils/projectPlaceholders';
import { getCustomVariables, setCustomVariables } from '@/utils/customVariablesStorage';

const TestTab = ({ projectId = 'project-1' }: { projectId?: string }) => (
  <VariablesApiTab
    styles={useProjectDetailsStyles()}
    projectId={projectId}
    isLoading={false}
    sections={[
      {
        id: 'project',
        label: 'Project',
        tables: [
          {
            id: 'details',
            label: 'Details',
            rows: [{ id: 'name', name: 'Project name', value: 'Example' }],
          },
        ],
      },
    ]}
  />
);

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('VariablesApiTab editing', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setProjectPlaceholders('project-1', { name: '{{ORIGINAL}}' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps edits and new custom variables out of storage until Save', () => {
    render(<TestTab />);
    const placeholder = screen.getByLabelText('Placeholder for Project name');
    expect(placeholder).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Add custom variable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear placeholders' })).toBeDisabled();

    click('Edit');
    expect(placeholder).not.toHaveAttribute('readonly');
    fireEvent.change(placeholder, { target: { value: '{{UPDATED}}' } });
    click('Add custom variable');
    fireEvent.change(screen.getByLabelText('Custom variable description'), {
      target: { value: 'Custom description' },
    });
    fireEvent.change(screen.getByLabelText('Custom variable placeholder'), {
      target: { value: '{{CUSTOM}}' },
    });
    expect(getProjectPlaceholders('project-1')).toEqual({ name: '{{ORIGINAL}}' });
    expect(getCustomVariables('project-1')).toEqual([]);

    click('Save');
    const [custom] = getCustomVariables('project-1');
    expect(custom.name).toBe('Custom description');
    expect(getProjectPlaceholders('project-1')).toEqual({
      name: '{{UPDATED}}',
      [custom.id]: '{{CUSTOM}}',
    });
    expect(placeholder).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('allows clearing and deletion to be cancelled or explicitly saved', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setCustomVariables('project-1', [{ id: 'custom-1', name: 'Original custom' }]);
    setProjectPlaceholders('project-1', {
      name: '{{ORIGINAL}}',
      'custom-1': '{{CUSTOM}}',
    });
    render(<TestTab />);

    click('Edit');
    click('Delete');
    click('Clear placeholders');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Placeholder for Project name')).toHaveValue('');
    expect(getCustomVariables('project-1')).toHaveLength(1);
    expect(getProjectPlaceholders('project-1')).toEqual({
      name: '{{ORIGINAL}}',
      'custom-1': '{{CUSTOM}}',
    });
    click('Cancel');
    expect(screen.getByLabelText('Placeholder for Project name')).toHaveValue('{{ORIGINAL}}');
    expect(screen.getByLabelText('Custom variable description')).toHaveValue('Original custom');

    click('Edit');
    click('Delete');
    click('Clear placeholders');
    click('Save');
    expect(getProjectPlaceholders('project-1')).toEqual({});
    expect(getCustomVariables('project-1')).toEqual([]);
  });

  it.each([1, 2])('preserves placeholders when confirmation %i is declined', (step) => {
    const confirm = vi.spyOn(window, 'confirm');
    if (step === 2) confirm.mockReturnValueOnce(true);
    confirm.mockReturnValueOnce(false);
    render(<TestTab />);
    click('Edit');
    click('Clear placeholders');
    expect(confirm).toHaveBeenCalledTimes(step);
    expect(screen.getByLabelText('Placeholder for Project name')).toHaveValue('{{ORIGINAL}}');
    click('Save');
    expect(getProjectPlaceholders('project-1')).toEqual({ name: '{{ORIGINAL}}' });
  });

  it('discards drafts on a project switch without overwriting either project', () => {
    setProjectPlaceholders('project-2', { name: '{{SECOND}}' });
    const { rerender } = render(<TestTab />);
    click('Edit');
    fireEvent.change(screen.getByLabelText('Placeholder for Project name'), {
      target: { value: '{{UNSAVED}}' },
    });
    click('Add custom variable');

    rerender(<TestTab projectId="project-2" />);
    expect(screen.getByLabelText('Placeholder for Project name')).toHaveValue('{{SECOND}}');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Custom variable description')).not.toBeInTheDocument();
    expect(getProjectPlaceholders('project-1')).toEqual({ name: '{{ORIGINAL}}' });
    expect(getProjectPlaceholders('project-2')).toEqual({ name: '{{SECOND}}' });
    expect(getCustomVariables('project-1')).toEqual([]);
    expect(getCustomVariables('project-2')).toEqual([]);
  });
});
