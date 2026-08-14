import { useState } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyCableInstallationMaterialForm } from '../CableInstallationMaterials.forms';
import type { CableInstallationMaterialFormState } from '../CableInstallationMaterials.forms';
import type { ProjectDetailsStyles } from '../../ProjectDetails.styles';
import { CableInstallationMaterialDialog } from './CableInstallationMaterialDialog';

const styles = {} as ProjectDetailsStyles;

const TestDialog = ({ mode }: { mode: 'create' | 'edit' }) => {
  const [values, setValues] = useState<CableInstallationMaterialFormState>({
    ...emptyCableInstallationMaterialForm,
    type: 'Cable gland',
    purpose: mode === 'edit' ? 'Control' : '',
  });

  return (
    <FluentProvider theme={webLightTheme}>
      <CableInstallationMaterialDialog
        styles={styles}
        open
        mode={mode}
        values={values}
        errors={{}}
        submitting={false}
        purposeOptions={['Control', 'Fiber optic', 'Power']}
        onFieldChange={(field) => (_event, data) =>
          setValues((previous) => ({ ...previous, [field]: data.value }))
        }
        onPurposeSelect={(_event, data) => {
          if (data.optionValue !== undefined) {
            setValues((previous) => ({ ...previous, purpose: data.optionValue ?? '' }));
          }
        }}
        onSubmit={(event) => event.preventDefault()}
        onDismiss={vi.fn()}
      />
    </FluentProvider>
  );
};

describe('CableInstallationMaterialDialog', () => {
  it.each(['create', 'edit'] as const)('shows a Source URL input in %s mode', (mode) => {
    render(<TestDialog mode={mode} />);

    expect(screen.getByRole('textbox', { name: 'Source' })).toHaveAttribute('type', 'url');
  });

  it.each(['create', 'edit'] as const)('allows a new purpose to be typed in %s mode', (mode) => {
    render(<TestDialog mode={mode} />);

    const purposeInput = screen.getByRole('combobox', { name: 'Purpose' });
    fireEvent.change(purposeInput, { target: { value: 'Temporary lighting' } });

    expect(purposeInput).toHaveValue('Temporary lighting');
  });

  it('filters and selects an existing purpose as the user types', () => {
    render(<TestDialog mode="create" />);

    const purposeInput = screen.getByRole('combobox', { name: 'Purpose' });
    fireEvent.change(purposeInput, { target: { value: 'Fiber' } });
    fireEvent.click(purposeInput);

    const suggestion = screen.getByRole('option', { name: 'Fiber optic' });
    expect(suggestion).toBeInTheDocument();

    fireEvent.click(suggestion);
    expect(purposeInput).toHaveValue('Fiber optic');
  });
});
