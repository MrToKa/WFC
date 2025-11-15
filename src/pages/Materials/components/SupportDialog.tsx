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
import { MaterialSupport } from '@/api/client';
import { SupportFormErrors, SupportFormState } from '../Materials.types';
import type { TemplateImageOption } from '../hooks/useTemplateImages';

type SupportDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  editingSupport: MaterialSupport | null;
  form: SupportFormState;
  formErrors: SupportFormErrors;
  isSubmitting: boolean;
  onFieldChange: (field: keyof SupportFormState) => (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onTemplateChange: (templateId: string | null) => void;
  templateOptions: TemplateImageOption[];
  selectedTemplateId: string | null;
  isTemplateLoading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

const NONE_OPTION_VALUE = '__none__';

export const SupportDialog = ({
  open,
  mode,
  editingSupport,
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
}: SupportDialogProps) => {
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
                ? 'Add support'
                : `Edit support${editingSupport ? `: ${editingSupport.type}` : ''}`}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Type'
                required
                validationState={formErrors.type ? 'error' : undefined}
                validationMessage={formErrors.type}
              >
                <Input
                  value={form.type}
                  onChange={onFieldChange('type')}
                  required
                />
              </Field>
              <Field
                label='Manufacturer'
                validationState={formErrors.manufacturer ? 'error' : undefined}
                validationMessage={formErrors.manufacturer}
              >
                <Input
                  value={form.manufacturer}
                  onChange={onFieldChange('manufacturer')}
                />
              </Field>
              <Field
                label='Height [mm]'
                validationState={formErrors.heightMm ? 'error' : undefined}
                validationMessage={formErrors.heightMm}
              >
                <Input
                  value={form.heightMm}
                  onChange={onFieldChange('heightMm')}
                />
              </Field>
              <Field
                label='Width [mm]'
                validationState={formErrors.widthMm ? 'error' : undefined}
                validationMessage={formErrors.widthMm}
              >
                <Input
                  value={form.widthMm}
                  onChange={onFieldChange('widthMm')}
                />
              </Field>
              <Field
                label='Length [mm]'
                validationState={formErrors.lengthMm ? 'error' : undefined}
                validationMessage={formErrors.lengthMm}
              >
                <Input
                  value={form.lengthMm}
                  onChange={onFieldChange('lengthMm')}
                />
              </Field>
              <Field
                label='Weight [kg]'
                validationState={formErrors.weightKg ? 'error' : undefined}
                validationMessage={formErrors.weightKg}
              >
                <Input
                  value={form.weightKg}
                  onChange={onFieldChange('weightKg')}
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
