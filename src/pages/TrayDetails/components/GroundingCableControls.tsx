import React, { ChangeEvent } from 'react';
import { Body1, Checkbox, Field, Dropdown, Option, Spinner } from '@fluentui/react-components';
import type { CheckboxOnChangeData } from '@fluentui/react-components';
import { CableType } from '../../../api/client';

interface GroundingCableControlsProps {
  includeGroundingCable: boolean;
  groundingPreferenceSaving: boolean;
  isAdmin: boolean;
  projectCableTypesLoading: boolean;
  projectCableTypesError: string | null;
  groundingCableTypes: CableType[];
  selectedGroundingCableTypeId: string | null;
  selectedGroundingCableLabel: string | undefined;
  groundingCableMissingWeight: boolean;
  onToggle: (_event: ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => void;
  onTypeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  formatCableTypeLabel: (type: CableType) => string;
  styles: Record<string, string>;
}

export const GroundingCableControls: React.FC<GroundingCableControlsProps> = ({
  includeGroundingCable,
  groundingPreferenceSaving,
  isAdmin,
  projectCableTypesLoading,
  projectCableTypesError,
  groundingCableTypes,
  selectedGroundingCableTypeId,
  selectedGroundingCableLabel,
  groundingCableMissingWeight,
  onToggle,
  onTypeSelect,
  formatCableTypeLabel,
  styles
}) => {
  return (
    <>
      <div className={styles.field}>
        <Checkbox
          label="Add grounding cable"
          checked={includeGroundingCable}
          onChange={onToggle}
          disabled={groundingPreferenceSaving || !isAdmin}
        />
        {includeGroundingCable && projectCableTypesLoading ? (
          <Spinner label="Loading cable types..." />
        ) : null}
        {includeGroundingCable && projectCableTypesError ? (
          <Body1 className={styles.errorText}>{projectCableTypesError}</Body1>
        ) : null}
        {includeGroundingCable &&
        !projectCableTypesLoading &&
        !projectCableTypesError &&
        groundingCableTypes.length === 0 ? (
          <Body1 className={styles.emptyState}>
            No grounding cable types available for this project.
          </Body1>
        ) : null}
      </div>
      {includeGroundingCable &&
      !projectCableTypesLoading &&
      !projectCableTypesError &&
      groundingCableTypes.length > 0 ? (
        <div className={styles.field}>
          <Field
            label="Grounding cable type"
            validationState={groundingCableMissingWeight ? 'error' : undefined}
            validationMessage={
              groundingCableMissingWeight
                ? 'Selected cable type does not include weight data. It will not affect calculations.'
                : undefined
            }
          >
            <Dropdown
              placeholder="Select cable type"
              selectedOptions={
                selectedGroundingCableTypeId ? [selectedGroundingCableTypeId] : []
              }
              value={selectedGroundingCableLabel}
              onOptionSelect={onTypeSelect}
              disabled={groundingPreferenceSaving || !isAdmin}
            >
              {groundingCableTypes.map((type) => (
                <Option key={type.id} value={type.id}>
                  {formatCableTypeLabel(type)}
                </Option>
              ))}
            </Dropdown>
          </Field>
        </div>
      ) : null}
    </>
  );
};
