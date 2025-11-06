import {
  Body1,
  Button,
  Caption1,
  Checkbox,
  Dropdown,
  Field,
  Input,
  Option
} from '@fluentui/react-components';

import type { MaterialSupport, Project } from '@/api/client';
import type { CableBundleSpacing } from '@/api/types';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import { formatNumeric } from '../ProjectDetails.utils';
import type {
  CableCategoryController,
  CableSpacingController
} from './hooks/useCableLayoutSettings';

type NumericFieldName =
  | 'secondaryTrayLength'
  | 'supportDistance'
  | 'supportWeight'
  | 'trayLoadSafetyFactor';

type NumericFieldConfig = {
  field: NumericFieldName;
  label: string;
  unit?: string;
  input: string;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSave: () => Promise<void>;
};

type SupportDistanceOverrideConfig = {
  trayType: string;
  trayWidthMm: number | null;
  hasWidthConflict: boolean;
  currentDistance: number | null;
  currentSupportType: string | null;
  defaultValue: number | null;
  input: string;
  selectedSupportId: string | null;
  selectedSupportLabel: string;
  selectedSupportMissing: boolean;
  supportOptions: MaterialSupport[];
  supportsLoading: boolean;
  supportsError: string | null;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSupportChange: (supportId: string | null) => void;
  onSave: () => Promise<void>;
};

type FormattedDates = {
  created: string;
  updated: string;
} | null;

type DetailsTabProps = {
  styles: ProjectDetailsStyles;
  project: Project;
  formattedDates: FormattedDates;
  isAdmin: boolean;
  cableSpacingField: CableSpacingController;
  cableCategoryCards: CableCategoryController[];
  numericFields: NumericFieldConfig[];
  supportDistanceOverrides: SupportDistanceOverrideConfig[];
};

export const DetailsTab = ({
  styles,
  project,
  formattedDates,
  isAdmin,
  cableSpacingField,
  cableCategoryCards,
  numericFields,
  supportDistanceOverrides
}: DetailsTabProps) => {
  const supportsErrorMessage =
    supportDistanceOverrides.find(
      (override) => override.supportsError
    )?.supportsError ?? null;

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Details">
      {formattedDates ? (
        <div className={styles.metadata}>
          <div className={styles.panel}>
            <Caption1>Created</Caption1>
            <Body1>{formattedDates.created}</Body1>
          </div>
          <div className={styles.panel}>
            <Caption1>Last updated</Caption1>
            <Body1>{formattedDates.updated}</Body1>
          </div>
        </div>
      ) : null}


      <div className={styles.panel}>
        <Caption1>Description</Caption1>
        <Body1>
          {project.description
            ? project.description
            : 'No description provided.'}
        </Body1>
      </div>
      <div className={styles.panel}>
        <Caption1>Project manager</Caption1>
        <Body1>
          {project.manager ? project.manager : 'No manager specified.'}
        </Body1>
      </div>
      <div className={styles.numericFieldsRow}>
        {numericFields.map((field) => {
          const currentValue = project[field.field];
          const isSpecified = currentValue !== null && currentValue !== undefined;
          const formattedValue = isSpecified
            ? `${formatNumeric(currentValue)}${field.unit ? ` ${field.unit}` : ''}`
            : 'Not specified';

          return (
            <div key={field.field} className={styles.numericField}>
              <Body1 className={styles.numericFieldLabel}>{field.label}</Body1>
              <Caption1>Current value</Caption1>
              <Body1>{formattedValue}</Body1>
              {isAdmin ? (
                <div className={styles.numericFieldControls}>
                  <Field
                    className={styles.numericFieldInput}
                    label={`Update value${field.unit ? ` [${field.unit}]` : ''}`}
                    validationState={field.error ? 'error' : undefined}
                    validationMessage={field.error}
                  >
                    <Input
                      value={field.input}
                      onChange={(_, data) => field.onInputChange(data.value)}
                      disabled={field.saving}
                      inputMode="decimal"
                      type="number"
                      step="0.001"
                      min={0}
                      size="small"
                    />
                  </Field>
                  <Button
                    appearance="primary"
                    size="small"
                    onClick={() => void field.onSave()}
                    disabled={field.saving}
                  >
                    {field.saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {supportDistanceOverrides.length > 0 ? (
        <div className={styles.panel}>
          <Caption1>Distance between supports by tray type</Caption1>
          <div className={styles.numericFieldsRow}>
            {supportDistanceOverrides.map((override) => {
              const hasDistanceOverride = override.currentDistance !== null;
              const distanceDisplay = hasDistanceOverride
                ? `${formatNumeric(override.currentDistance)} m`
                : override.defaultValue !== null
                ? `Default (${formatNumeric(override.defaultValue)} m)`
                : 'Not specified';
              const supportDisplay =
                override.currentSupportType ?? 'Not specified';
              const trayWidthDisplay =
                override.trayWidthMm !== null
                  ? `${override.trayWidthMm.toLocaleString()} mm`
                  : 'Not recorded';
              const supportPlaceholder = override.supportsLoading
                ? 'Loading supports...'
                : override.supportOptions.length > 0
                ? 'Select support'
                : override.trayWidthMm !== null && !override.hasWidthConflict
                ? 'No matching supports'
                : 'No supports available';
              const dropdownDisabled =
                override.saving || override.supportsLoading;
              const selectedOption = override.selectedSupportId ?? '';

              return (
                <div key={override.trayType} className={styles.numericField}>
                  <Body1 className={styles.numericFieldLabel}>
                    {override.trayType}
                  </Body1>
                  <Caption1>Current distance</Caption1>
                  <Body1>{distanceDisplay}</Body1>
                  <Caption1>Current support</Caption1>
                  <Body1>
                    {supportDisplay}
                    {override.selectedSupportMissing
                      ? ' (not in catalogue)'
                      : ''}
                  </Body1>
                  <Caption1>Tray width</Caption1>
                  <Body1>
                    {trayWidthDisplay}
                    {override.hasWidthConflict
                      ? ' (multiple widths detected)'
                      : ''}
                  </Body1>
                  {override.supportOptions.length === 0 && !override.supportsLoading ? (
                    <Caption1>
                      {override.trayWidthMm !== null && !override.hasWidthConflict
                        ? 'No supports with matching length were found.'
                        : 'No supports available.'}
                    </Caption1>
                  ) : null}
                  {isAdmin ? (
                    <div className={styles.numericFieldControls}>
                      <Field
                        className={styles.numericFieldInput}
                        label="Override distance [m]"
                        validationState={override.error ? 'error' : undefined}
                        validationMessage={override.error}
                      >
                        <Input
                          value={override.input}
                          onChange={(_, data) =>
                            override.onInputChange(data.value)
                          }
                          disabled={override.saving}
                          inputMode="decimal"
                          type="number"
                          step="0.001"
                          min={0}
                          size="small"
                        />
                      </Field>
                      <Field
                        className={styles.numericFieldInput}
                        label="Select support"
                      >
                        <Dropdown
                          value={override.selectedSupportLabel}
                          placeholder={supportPlaceholder}
                          selectedOptions={[selectedOption]}
                          onOptionSelect={(_, data) => {
                            const optionValue =
                              typeof data.optionValue === 'string'
                                ? data.optionValue
                                : null;
                            override.onSupportChange(
                              optionValue && optionValue !== ''
                                ? optionValue
                                : null
                            );
                          }}
                          disabled={dropdownDisabled}
                        >
                          <Option value="" text="None (use default support)">
                            None (use default support)
                          </Option>
                          {override.selectedSupportId &&
                          override.selectedSupportId !== '' &&
                          !override.supportOptions.some(
                            (support) =>
                              support.id === override.selectedSupportId
                          ) ? (
                            <Option
                              value={override.selectedSupportId}
                              text={override.selectedSupportLabel}
                            >
                              {override.selectedSupportLabel}
                            </Option>
                          ) : null}
                          {override.supportOptions.map((support) => {
                            const label =
                              support.lengthMm !== null
                                ? `${support.type} - ${support.lengthMm.toLocaleString()} mm`
                                : support.type;

                            return (
                              <Option key={support.id} value={support.id} text={label}>
                                {label}
                              </Option>
                            );
                          })}
                        </Dropdown>
                      </Field>
                      <Button
                        appearance="primary"
                        size="small"
                        onClick={() => void override.onSave()}
                        disabled={override.saving}
                      >
                        {override.saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {isAdmin ? (
            <Caption1 className={styles.supportOverridesNote}>
              Leave the distance empty and clear the support selection to use the defaults.
            </Caption1>
          ) : null}
      {supportsErrorMessage ? (
        <Body1 className={styles.errorText}>{supportsErrorMessage}</Body1>
      ) : null}
    </div>
  ) : null}

      <div className={styles.panel}>
        <Caption1>Bundles configuration</Caption1>
        <div className={styles.numericFieldsRow}>
          <div className={styles.numericField}>
            <Body1 className={styles.numericFieldLabel}>
              {cableSpacingField.label}
            </Body1>
            <Caption1>Current value</Caption1>
            <Body1>{formatNumeric(cableSpacingField.currentValue)}</Body1>
            <Caption1>Current minimum free space</Caption1>
            <Body1>
              {cableSpacingField.minFreeSpaceCurrent !== null
                ? `${cableSpacingField.minFreeSpaceCurrent}%`
                : '-'}
            </Body1>
            <Caption1>Current maximum free space</Caption1>
            <Body1>
              {cableSpacingField.maxFreeSpaceCurrent !== null
                ? `${cableSpacingField.maxFreeSpaceCurrent}%`
                : '-'}
            </Body1>
            {isAdmin ? (
              <div className={styles.numericFieldControls}>
                <Field
                  className={styles.numericFieldInput}
                  label="Update value (1-5)"
                  validationState={cableSpacingField.error ? 'error' : undefined}
                  validationMessage={cableSpacingField.error ?? undefined}
                >
                  <Input
                    value={cableSpacingField.input}
                    onChange={(_, data) =>
                      cableSpacingField.onInputChange(data.value)
                    }
                    disabled={cableSpacingField.saving}
                    inputMode="decimal"
                    type="number"
                    step="0.1"
                    min={1}
                    max={5}
                    size="small"
                  />
                </Field>
                <Field
                  className={styles.numericFieldInput}
                  label="Minimum tray free space (1-100%)"
                  validationState={
                    cableSpacingField.minFreeSpaceError ? 'error' : undefined
                  }
                  validationMessage={
                    cableSpacingField.minFreeSpaceError ?? undefined
                  }
                >
                  <Input
                    value={cableSpacingField.minFreeSpaceInput}
                    onChange={(_, data) =>
                      cableSpacingField.onMinFreeSpaceChange(data.value)
                    }
                    disabled={cableSpacingField.saving}
                    inputMode="numeric"
                    type="number"
                    step={1}
                    min={1}
                    max={100}
                    size="small"
                  />
                </Field>
                <Field
                  className={styles.numericFieldInput}
                  label="Maximum free space (1-100%)"
                  validationState={
                    cableSpacingField.maxFreeSpaceError ? 'error' : undefined
                  }
                  validationMessage={
                    cableSpacingField.maxFreeSpaceError ?? undefined
                  }
                >
                  <Input
                    value={cableSpacingField.maxFreeSpaceInput}
                    onChange={(_, data) =>
                      cableSpacingField.onMaxFreeSpaceChange(data.value)
                    }
                    disabled={cableSpacingField.saving}
                    inputMode="numeric"
                    type="number"
                    step={1}
                    min={1}
                    max={100}
                    size="small"
                  />
                </Field>
                <Button
                  appearance="primary"
                  size="small"
                  onClick={() => void cableSpacingField.onSave()}
                  disabled={cableSpacingField.saving}
                >
                  {cableSpacingField.saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            ) : null}
            <Checkbox
              label="Consider space between bundles as free"
              checked={cableSpacingField.considerBundleSpacingAsFree}
              onChange={(_, data) => {
                if (typeof data.checked === 'boolean') {
                  void cableSpacingField.onToggleConsiderBundleSpacingAsFree(
                    data.checked
                  );
                }
              }}
              disabled={!isAdmin || cableSpacingField.saving}
            />
          </div>
          {cableCategoryCards.map((card) => {
            const currentMaxRows = card.displayMaxRows.toLocaleString();
            const currentMaxColumns = card.displayMaxColumns.toLocaleString();
            const currentBundleSpacing = card.displayBundleSpacing;
            const currentTrefoilDisplay = card.showTrefoil
              ? card.displayTrefoil === null
                ? 'Not specified'
                : card.displayTrefoil
                ? 'Enabled'
                : 'Disabled'
              : null;
            const currentTrefoilSpacingDisplay =
              card.allowTrefoilSpacing && card.displayTrefoilSpacing !== null
                ? card.displayTrefoilSpacing
                  ? 'Enabled'
                  : 'Disabled'
                : null;
            const currentPhaseRotationDisplay =
              card.allowPhaseRotation && card.displayPhaseRotation !== null
                ? card.displayPhaseRotation
                  ? 'Enabled'
                  : 'Disabled'
                : null;

            return (
              <div key={card.key} className={styles.numericField}>
                <Body1 className={styles.numericFieldLabel}>{card.label}</Body1>
                <Caption1>Current max rows</Caption1>
                <Body1>{currentMaxRows}</Body1>
                <Caption1>Current max columns</Caption1>
                <Body1>{currentMaxColumns}</Body1>
                <Caption1>Current space between bundles</Caption1>
                <Body1>{currentBundleSpacing}</Body1>
                {card.showTrefoil ? (
                  <>
                    <Caption1>Trefoil</Caption1>
                    <Body1>{currentTrefoilDisplay}</Body1>
                    {card.allowTrefoilSpacing ? (
                      <>
                        <Caption1>Space between trefoil bundles</Caption1>
                        <Body1>
                          {currentTrefoilSpacingDisplay ?? 'Not specified'}
                        </Body1>
                      </>
                    ) : null}
                    {card.allowPhaseRotation ? (
                      <>
                        <Caption1>Phase rotation</Caption1>
                        <Body1>
                          {currentPhaseRotationDisplay ?? 'Not specified'}
                        </Body1>
                      </>
                    ) : null}
                  </>
                ) : null}
                {isAdmin ? (
                  <>
                    <Field
                      className={styles.numericFieldInput}
                      label="Max rows"
                      validationState={card.errors.maxRows ? 'error' : undefined}
                      validationMessage={card.errors.maxRows}
                    >
                      <Input
                        value={card.inputMaxRows}
                        onChange={(_, data) =>
                          card.onMaxRowsChange(data.value)
                        }
                        disabled={card.saving}
                        inputMode="numeric"
                        type="number"
                        min={1}
                        max={1000}
                        step="1"
                        size="small"
                      />
                    </Field>
                    <Field
                      className={styles.numericFieldInput}
                      label="Max columns"
                      validationState={
                        card.errors.maxColumns ? 'error' : undefined
                      }
                      validationMessage={card.errors.maxColumns}
                    >
                      <Input
                        value={card.inputMaxColumns}
                        onChange={(_, data) =>
                          card.onMaxColumnsChange(data.value)
                        }
                        disabled={card.saving}
                        inputMode="numeric"
                        type="number"
                        min={1}
                        max={1000}
                        step="1"
                        size="small"
                      />
                    </Field>
                    <Field
                      className={styles.numericFieldInput}
                      label="Space between bundles"
                    >
                      <Dropdown
                        value={card.inputBundleSpacing ?? ''}
                        placeholder="Not specified"
                        selectedOptions={
                          card.inputBundleSpacing
                            ? [card.inputBundleSpacing]
                            : []
                        }
                        onOptionSelect={(_, data) => {
                          const optionValue =
                            typeof data.optionValue === 'string' &&
                            data.optionValue !== ''
                              ? (data.optionValue as CableBundleSpacing)
                              : null;
                          card.onBundleSpacingChange(optionValue);
                        }}
                        disabled={card.saving}
                      >
                        <Option value="">Not specified</Option>
                        <Option value="0">0</Option>
                        <Option value="1D">1D</Option>
                        <Option value="2D">2D</Option>
                      </Dropdown>
                    </Field>
                    {card.showTrefoil ? (
                      <Checkbox
                        label="Trefoil"
                        checked={card.inputTrefoil}
                        onChange={(_, data) =>
                          card.onTrefoilChange(Boolean(data.checked))
                        }
                        disabled={card.saving}
                      />
                    ) : null}
                    {card.allowTrefoilSpacing && card.inputTrefoil ? (
                      <Checkbox
                        label="Space between trefoil bundles"
                        checked={card.inputTrefoilSpacing}
                        onChange={(_, data) =>
                          card.onTrefoilSpacingChange(Boolean(data.checked))
                        }
                        disabled={card.saving}
                      />
                    ) : null}
                    {card.allowPhaseRotation && card.inputTrefoil ? (
                      <Checkbox
                        label="Apply phase rotation"
                        checked={card.inputPhaseRotation}
                        onChange={(_, data) =>
                          card.onPhaseRotationChange(Boolean(data.checked))
                        }
                        disabled={card.saving}
                      />
                    ) : null}
                    {card.errors.general ? (
                      <Body1 className={styles.errorText}>
                        {card.errors.general}
                      </Body1>
                    ) : null}
                    <div className={styles.numericFieldControls}>
                      <Button
                        appearance="primary"
                        size="small"
                        onClick={() => void card.onSave()}
                        disabled={card.saving}
                      >
                        {card.saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
