import React, { ChangeEvent, useEffect, useState } from 'react';
import { Body1, Checkbox, Field, Input } from '@fluentui/react-components';
import type { CheckboxOnChangeData } from '@fluentui/react-components';
import { TREFOIL_CLAMPS } from '../trefoilClamps';

interface TrefoilClampControlsProps {
  useTrefoilClamps: boolean;
  saving: boolean;
  canEdit: boolean;
  spacingMm: number;
  onToggle: (_event: ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => void;
  onSpacingSave: (spacingMm: number) => void;
  summaries: string[];
  issues: string[];
  groupCount: number;
  totalCount: number | null;
  totalWeightKg: number | null;
  weightPerMeterKg: number | null;
  styles: Record<string, string>;
}

export const TrefoilClampControls: React.FC<TrefoilClampControlsProps> = ({
  useTrefoilClamps,
  saving,
  canEdit,
  spacingMm,
  onToggle,
  onSpacingSave,
  summaries,
  issues,
  groupCount,
  totalCount,
  totalWeightKg,
  weightPerMeterKg,
  styles,
}) => {
  const [spacingDraft, setSpacingDraft] = useState(String(spacingMm));
  const [spacingError, setSpacingError] = useState<string | undefined>();

  useEffect(() => {
    setSpacingDraft(String(spacingMm));
    setSpacingError(undefined);
  }, [spacingMm, useTrefoilClamps]);

  const saveSpacing = () => {
    if (saving || !canEdit) return;
    const value = Number(spacingDraft);
    if (spacingDraft.trim() === '' || !Number.isFinite(value) || value <= 0 || value > 1_000_000) {
      setSpacingError('Enter a spacing greater than 0 and up to 1,000,000 mm.');
      return;
    }
    setSpacingError(undefined);
    if (value !== spacingMm) onSpacingSave(value);
  };

  return (
    <>
      <div className={styles.field}>
        <Checkbox
          label="Use Trefoild clamps"
          checked={useTrefoilClamps}
          onChange={(event, data) => {
            if (canEdit && !saving) onToggle(event, data);
          }}
          disabled={saving || !canEdit}
        />
      </div>
      {useTrefoilClamps ? (
        <div className={styles.field}>
          <Body1>
            Vulcan+ trefoil range: {TREFOIL_CLAMPS.length} models for cable diameters from{' '}
            {Math.min(...TREFOIL_CLAMPS.map((clamp) => clamp.minDiameterMm))} to{' '}
            {Math.max(...TREFOIL_CLAMPS.map((clamp) => clamp.maxDiameterMm))} mm. Each model is
            selected automatically to fit all three cables.
          </Body1>
          <Field
            label="Clamp spacing [mm]"
            validationState={spacingError ? 'error' : undefined}
            validationMessage={spacingError}
          >
            <Input
              type="number"
              min={0}
              max={1_000_000}
              step="any"
              value={spacingDraft}
              onChange={(_event, data) => {
                if (saving || !canEdit) return;
                setSpacingDraft(data.value);
                setSpacingError(undefined);
              }}
              onBlur={saveSpacing}
              disabled={saving || !canEdit}
            />
          </Field>
          <Body1>Clamps are counted at both tray ends and at the chosen maximum spacing.</Body1>
          {groupCount === 0 ? (
            <Body1 className={styles.emptyState}>
              No trefoil groups on this tray. Enable trefoil laying in the bundle settings to use
              clamps.
            </Body1>
          ) : (
            <>
              <Body1>Trefoil groups: {groupCount}</Body1>
              {summaries.length > 0 ? (
                <ul aria-label="Selected clamps">
                  {summaries.map((summary, index) => (
                    <li key={index}>{summary}</li>
                  ))}
                </ul>
              ) : null}
              {totalCount !== null ? <Body1>Clamp quantity: {totalCount}</Body1> : null}
              {totalWeightKg !== null ? (
                <Body1>Total clamp weight: {totalWeightKg.toFixed(3)} kg</Body1>
              ) : null}
              {weightPerMeterKg !== null ? (
                <Body1>Clamp load: {weightPerMeterKg.toFixed(3)} kg/m</Body1>
              ) : null}
            </>
          )}
          {issues.map((issue, index) => (
            <Body1 key={index} className={styles.errorText}>
              {issue}
            </Body1>
          ))}
        </div>
      ) : null}
    </>
  );
};
