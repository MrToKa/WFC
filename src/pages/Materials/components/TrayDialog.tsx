import type { FormEvent, ChangeEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Dropdown,
  Option
} from '@fluentui/react-components';
import { MaterialTray } from '@/api/client';
import { TrayFormErrors, TrayFormState } from '../Materials.types';
import type { TemplateImageOption } from '../hooks/useTemplateImages';

type TrayDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  editingTray: MaterialTray | null;
  form: TrayFormState;
  formErrors: TrayFormErrors;
  isSubmitting: boolean;
  onFieldChange: (field: keyof TrayFormState) => (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onTemplateChange: (templateId: string | null) => void;
  templateOptions: TemplateImageOption[];
  selectedTemplateId: string | null;
  isTemplateLoading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

const NONE_OPTION_VALUE = '__none__';

export const TrayDialog = ({
  open,
  mode,
  editingTray,
  form,
  formErrors,
  isSubmitting,
  onFieldChange,
  onTemplateChange,
  templateOptions,
  selectedTemplateId,
  isTemplateLoading,
  onSubmit,
  onClose,
  dialogActionsClassName
}: TrayDialogProps) => {
  const selectedOptions =
    selectedTemplateId && selectedTemplateId !== ''
      ? [selectedTemplateId]
      : [NONE_OPTION_VALUE];
  const selectedOption =
    selectedTemplateId && selectedTemplateId !== ''
      ? templateOptions.find((option) => option.id === selectedTemplateId)
      : null;
  const dropdownValue =
    selectedOption?.fileName ??
    (!selectedTemplateId || selectedTemplateId === '' ? 'No image' : undefined);

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
                ? 'Add tray'
                : `Edit tray${editingTray ? `: ${editingTray.type}` : ''}`}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Type'
                required
                validationState={formErrors.type ? 'error' : undefined}
                validationMessage={formErrors.type}
              >
                <Input value={form.type} onChange={onFieldChange('type')} required />
              </Field>
              <Field
                label='Purpose'
                required
                validationState={formErrors.purpose ? 'error' : undefined}
                validationMessage={formErrors.purpose}
              >
                <Input value={form.purpose} onChange={onFieldChange('purpose')} required />
              </Field>
              <Field
                label='Height [mm]'
                validationState={formErrors.heightMm ? 'error' : undefined}
                validationMessage={formErrors.heightMm}
              >
                <Input value={form.heightMm} onChange={onFieldChange('heightMm')} />
              </Field>
              <Field
                label='Rung height [mm]'
                validationState={formErrors.rungHeightMm ? 'error' : undefined}
                validationMessage={formErrors.rungHeightMm}
              >
                <Input value={form.rungHeightMm} onChange={onFieldChange('rungHeightMm')} />
              </Field>
              <Field
                label='Width [mm]'
                validationState={formErrors.widthMm ? 'error' : undefined}
                validationMessage={formErrors.widthMm}
              >
                <Input value={form.widthMm} onChange={onFieldChange('widthMm')} />
              </Field>
              <Field
                label='Weight [kg/m]'
                validationState={formErrors.weightKgPerM ? 'error' : undefined}
                validationMessage={formErrors.weightKgPerM}
              >
                <Input
                  value={form.weightKgPerM}
                  onChange={onFieldChange('weightKgPerM')}
                />
              </Field>
              <Field
                label='Image template'
                hint={
                  isTemplateLoading
                    ? 'Loading templates...'
                    : templateOptions.length === 0
                    ? 'No shared images available yet.'
                    : 'Assign an image from the Templates library.'
                }
              >
                <Dropdown
                  selectedOptions={selectedOptions}
                  value={dropdownValue}
                  onOptionSelect={(_, data) => {
                    const optionValue = data.optionValue ?? NONE_OPTION_VALUE;
                    onTemplateChange(
                      optionValue === NONE_OPTION_VALUE ? null : optionValue
                    );
                  }}
                  disabled={isTemplateLoading}
                >
                  <Option value={NONE_OPTION_VALUE}>No image</Option>
                  {templateOptions.map((option) => (
                    <Option key={option.id} value={option.id}>
                      {option.fileName}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            </DialogContent>
            <DialogActions className={dialogActionsClassName}>
              <Button appearance='secondary' onClick={onClose}>
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
