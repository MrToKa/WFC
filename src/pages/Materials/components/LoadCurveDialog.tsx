import type { ChangeEvent, FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Textarea
} from '@fluentui/react-components';
import type { OptionOnSelectData } from '@fluentui/react-components';
import type { MaterialLoadCurve } from '@/api/client';
import type { LoadCurveFormErrors, LoadCurveFormState } from '../Materials.types';

type TrayOption = {
  id: string;
  label: string;
};

type LoadCurveDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  editingLoadCurve: MaterialLoadCurve | null;
  form: LoadCurveFormState;
  formErrors: LoadCurveFormErrors;
  isSubmitting: boolean;
  trayOptions: TrayOption[];
  isLoadingTrays: boolean;
  onFieldChange: (
    field: keyof LoadCurveFormState
  ) => (_event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => void;
  onTrayChange: (_event: unknown, data: OptionOnSelectData) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

export const LoadCurveDialog = ({
  open,
  mode,
  editingLoadCurve,
  form,
  formErrors,
  isSubmitting,
  trayOptions,
  isLoadingTrays,
  onFieldChange,
  onTrayChange,
  onSubmit,
  onClose,
  dialogActionsClassName
}: LoadCurveDialogProps) => {
  const selectedTray = form.trayId
    ? trayOptions.find((option) => option.id === form.trayId)
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) {
          onClose();
        }
      }}
    >
      <DialogSurface>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <DialogTitle>
              {mode === 'create'
                ? 'Add load curve'
                : `Edit load curve${editingLoadCurve ? `: ${editingLoadCurve.name}` : ''}`}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Name'
                required
                validationState={formErrors.name ? 'error' : undefined}
                validationMessage={formErrors.name}
              >
                <Input
                  value={form.name}
                  onChange={onFieldChange('name')}
                  required
                />
              </Field>
              <Field
                label='Associated tray (optional)'
                validationState={formErrors.trayId ? 'error' : undefined}
                validationMessage={formErrors.trayId}
              >
                <Dropdown
                  placeholder={isLoadingTrays ? 'Loading trays…' : 'Select tray'}
                  selectedOptions={form.trayId ? [form.trayId] : []}
                  value={selectedTray?.label ?? ''}
                  onOptionSelect={onTrayChange}
                  disabled={isLoadingTrays}
                >
                  <Option value=''>No tray assigned</Option>
                  {trayOptions.map((option) => (
                    <Option key={option.id} value={option.id}>
                      {option.label}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field
                label='Description (optional)'
                validationState={formErrors.description ? 'error' : undefined}
                validationMessage={formErrors.description}
              >
                <Textarea
                  value={form.description}
                  onChange={onFieldChange('description')}
                  rows={4}
                />
              </Field>
            </DialogContent>
            <DialogActions className={dialogActionsClassName}>
              <Button appearance='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button appearance='primary' type='submit' disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
