import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Body1,
  Body2,
  Button,
  Caption1,
  Card,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Textarea,
  Title2,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import type { OptionOnSelectData } from '@fluentui/react-components';
import {
  ApiError,
  MaterialLoadCurve,
  MaterialTray,
  fetchAllMaterialTrays,
  fetchMaterialLoadCurve,
  importMaterialLoadCurvePoints,
  updateMaterialLoadCurve
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { LoadCurveChart } from './Materials/components/LoadCurveChart';

type PointFormRow = {
  id?: string;
  spanM: string;
  loadKnPerM: string;
};

type DetailsFormState = {
  name: string;
  trayId: string;
  description: string;
};

type DetailsFormErrors = Partial<Record<keyof DetailsFormState, string>>;

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gap: '1.5rem',
    ...shorthands.padding('2rem', '1.5rem', '4rem')
  },
  header: {
    display: 'grid',
    gap: '0.75rem'
  },
  headerActions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  layout: {
    display: 'grid',
    gap: '1.5rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    justifyContent: 'center',
    justifyItems: 'center'
  },
  detailCard: {
    display: 'grid',
    gap: '0.75rem',
    alignContent: 'start',
    width: '360px',
    maxWidth: '100%'
  },
  detailCardContent: {
    width: '100%',
    display: 'grid',
    gap: '1rem'
  },
  detailCardFooter: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  chart: {
    width: '100%',
    maxWidth: '300px',
    height: '180px',
    margin: '0 auto'
  },
  readOnlyNotice: {
    color: tokens.colorNeutralForeground3
  },
  pointsSection: {
    display: 'grid',
    gap: '1rem'
  },
  pointsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  pointsActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  hiddenInput: {
    display: 'none'
  },
  pointsTableWrapper: {
    width: '100%',
    overflowX: 'auto'
  },
  pointsTable: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  pointsHeadCell: {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold
  },
  pointsCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  numericCell: {
    textAlign: 'right'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  spinnerWrapper: {
    display: 'grid',
    placeItems: 'center',
    minHeight: '240px'
  }
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const parsePointValue = (value: string): { value?: number; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { error: 'Value is required' };
  }
  const normalized = trimmed.replace(',', '.');
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { error: 'Enter a valid non-negative number' };
  }
  return { value: numeric };
};

export const LoadCurveDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { loadCurveId } = useParams<{ loadCurveId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);

  const [loadCurve, setLoadCurve] = useState<MaterialLoadCurve | null>(null);
  const [materialTrays, setMaterialTrays] = useState<MaterialTray[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingTrays, setIsLoadingTrays] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [detailsForm, setDetailsForm] = useState<DetailsFormState>({
    name: '',
    trayId: '',
    description: ''
  });
  const [detailsErrors, setDetailsErrors] = useState<DetailsFormErrors>({});
  const [isSavingDetails, setIsSavingDetails] = useState<boolean>(false);

  const [pointsForm, setPointsForm] = useState<PointFormRow[]>([]);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [isSavingPoints, setIsSavingPoints] = useState<boolean>(false);
  const [isImportingPoints, setIsImportingPoints] = useState<boolean>(false);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const applyLoadCurve = useCallback((curve: MaterialLoadCurve) => {
    setLoadCurve(curve);
    setDetailsForm({
      name: curve.name,
      trayId: curve.trayId ?? '',
      description: curve.description ?? ''
    });
    setPointsForm(
      curve.points.map((point) => ({
        id: point.id,
        spanM: String(point.spanM),
        loadKnPerM: String(point.loadKnPerM)
      }))
    );
  }, []);

  const loadData = useCallback(async () => {
    if (!loadCurveId) {
      setError('Load curve identifier is missing.');
      setIsLoading(false);
      setIsLoadingTrays(false);
      return;
    }

    setIsLoading(true);
    setIsLoadingTrays(true);
    try {
      const [curveResult, traysResult] = await Promise.allSettled([
        fetchMaterialLoadCurve(loadCurveId),
        fetchAllMaterialTrays()
      ]);

      if (curveResult.status === 'fulfilled') {
        applyLoadCurve(curveResult.value.loadCurve);
        setError(null);
      } else {
        const reason = curveResult.reason;
        if (reason instanceof ApiError && reason.status === 404) {
          setError('Load curve not found.');
        } else {
          setError('Failed to load load curve.');
        }
        return;
      }

      if (traysResult.status === 'fulfilled') {
        setMaterialTrays(traysResult.value.trays);
      } else {
        console.error('Failed to load material trays', traysResult.reason);
        setMaterialTrays([]);
      }
    } catch (err) {
      console.error('Failed to load load curve details', err);
      setError('Failed to load load curve.');
    } finally {
      setIsLoading(false);
      setIsLoadingTrays(false);
    }
  }, [applyLoadCurve, loadCurveId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const trayOptions = useMemo(
    () =>
      materialTrays.map((tray) => ({
        id: tray.id,
        label: tray.type
      })),
    [materialTrays]
  );

  const handleDetailsChange =
    (field: keyof DetailsFormState) =>
    (_event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => {
      setDetailsForm((previous) => ({ ...previous, [field]: data.value }));
      setDetailsErrors((previous) => ({ ...previous, [field]: undefined }));
    };

  const handleDetailsTraySelect = (_event: unknown, data: OptionOnSelectData) => {
    setDetailsForm((previous) => ({
      ...previous,
      trayId: data.optionValue ?? ''
    }));
    setDetailsErrors((previous) => ({ ...previous, trayId: undefined }));
  };

  const handleDetailsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loadCurve || !loadCurveId) {
      return;
    }

    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to update load curves.'
      });
      return;
    }

    const nextErrors: DetailsFormErrors = {};
    if (!detailsForm.name.trim()) {
      nextErrors.name = 'Name is required';
    }

    if (Object.keys(nextErrors).length > 0) {
      setDetailsErrors(nextErrors);
      return;
    }

    setIsSavingDetails(true);
    try {
      const response = await updateMaterialLoadCurve(token, loadCurveId, {
        name: detailsForm.name.trim(),
        description: detailsForm.description.trim() === '' ? null : detailsForm.description.trim(),
        trayId: detailsForm.trayId.trim() === '' ? null : detailsForm.trayId.trim()
      });
      applyLoadCurve(response.loadCurve);
      showToast({ intent: 'success', title: 'Load curve updated' });
    } catch (err) {
      console.error('Failed to update load curve details', err);
      if (err instanceof ApiError && err.status === 409) {
        setDetailsErrors({ name: 'A load curve with this name already exists' });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to update details',
          body: 'Please try again.'
        });
      }
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handlePointFieldChange =
    (index: number, field: keyof PointFormRow) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setPointsForm((previous) => {
        const next = [...previous];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
      setPointsError(null);
    };

  const handleAddPoint = () => {
    setPointsForm((previous) => [
      ...previous,
      {
        spanM: '',
        loadKnPerM: ''
      }
    ]);
  };

  const handleRemovePoint = (index: number) => {
    setPointsForm((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleResetPoints = () => {
    if (!loadCurve) {
      return;
    }
    setPointsForm(
      loadCurve.points.map((point) => ({
        id: point.id,
        spanM: String(point.spanM),
        loadKnPerM: String(point.loadKnPerM)
      }))
    );
    setPointsError(null);
  };

  const handlePointsSave = async () => {
    if (!loadCurveId) {
      return;
    }

    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to update load curve points.'
      });
      return;
    }

    if (pointsForm.length === 0) {
      setPointsError('Add at least two points before saving.');
      return;
    }

    const parsedPoints: { spanM: number; loadKnPerM: number }[] = [];

    for (let index = 0; index < pointsForm.length; index += 1) {
      const row = pointsForm[index];
      const spanResult = parsePointValue(row.spanM);
      if (spanResult.error) {
        setPointsError(`Row ${index + 1}: ${spanResult.error}`);
        return;
      }
      const loadResult = parsePointValue(row.loadKnPerM);
      if (loadResult.error) {
        setPointsError(`Row ${index + 1}: ${loadResult.error}`);
        return;
      }
      parsedPoints.push({
        spanM: spanResult.value ?? 0,
        loadKnPerM: loadResult.value ?? 0
      });
    }

    if (parsedPoints.length < 2) {
      setPointsError('Add at least two points before saving.');
      return;
    }

    parsedPoints.sort((a, b) => a.spanM - b.spanM);

    setIsSavingPoints(true);
    try {
      const response = await updateMaterialLoadCurve(token, loadCurveId, {
        points: parsedPoints
      });
      applyLoadCurve(response.loadCurve);
      showToast({ intent: 'success', title: 'Curve points updated' });
    } catch (err) {
      console.error('Failed to update load curve points', err);
      showToast({
        intent: 'error',
        title: 'Failed to update points',
        body: 'Please try again.'
      });
    } finally {
      setIsSavingPoints(false);
    }
  };

  const handleImportClick = () => {
    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be an admin to import curve points.'
      });
      return;
    }
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file || !loadCurveId) {
      return;
    }

    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to import curve points.'
      });
      return;
    }

    setIsImportingPoints(true);
    try {
      const response = await importMaterialLoadCurvePoints(token, loadCurveId, file);
      applyLoadCurve(response.loadCurve);
      setPointsError(null);
      showToast({
        intent: 'success',
        title: 'Curve points imported',
        body: `Imported ${response.summary.importedPoints} points.`
      });
    } catch (err) {
      console.error('Failed to import curve points', err);
      if (err instanceof ApiError && err.status === 400) {
        showToast({
          intent: 'error',
          title: 'Invalid file format',
          body: 'Ensure the Excel file contains a CurveData sheet with numeric values.'
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Import failed',
          body: 'Please verify the file and try again.'
        });
      }
    } finally {
      setIsImportingPoints(false);
    }
  };

  const pageTitle = loadCurve ? `Load curve - ${loadCurve.name}` : 'Load curve';
  const updatedAt = loadCurve
    ? `Last updated ${dateFormatter.format(new Date(loadCurve.updatedAt))}`
    : null;

  if (isLoading) {
    return (
      <section className={styles.root} aria-labelledby='load-curve-heading'>
        <div className={styles.spinnerWrapper}>
          <Spinner label='Loading load curve...' />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.root} aria-labelledby='load-curve-heading'>
        <div className={styles.header}>
          <Title2 id='load-curve-heading'>Load curve details</Title2>
          <Body1 className={styles.errorText}>{error}</Body1>
          <div className={styles.headerActions}>
            <Button appearance='primary' onClick={() => navigate('/materials')}>
              Back to materials
            </Button>
            <Button onClick={() => loadData()}>Retry</Button>
          </div>
        </div>
      </section>
    );
  }

  if (!loadCurve) {
    return null;
  }

  return (
    <section className={styles.root} aria-labelledby='load-curve-heading'>
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <Button appearance='secondary' onClick={() => navigate('/materials')}>
            Back to materials
          </Button>
          <Button onClick={() => loadData()}>Refresh</Button>
        </div>
        <Title2 id='load-curve-heading'>{pageTitle}</Title2>
        {updatedAt ? <Caption1>{updatedAt}</Caption1> : null}
      </div>

      <div className={styles.layout}>
        <Card appearance='outline' className={styles.detailCard}>
          <Title3>General information</Title3>
          <form onSubmit={handleDetailsSubmit} className={styles.detailCardContent}>
            <Field
              label='Name'
              required
              validationState={detailsErrors.name ? 'error' : undefined}
              validationMessage={detailsErrors.name}
            >
              <Input
                value={detailsForm.name}
                onChange={handleDetailsChange('name')}
                disabled={!isAdmin}
                required
              />
            </Field>
            <Field label='Associated tray (optional)'>
              <Dropdown
                placeholder={isLoadingTrays ? 'Loading trays...' : 'Select tray'}
                selectedOptions={detailsForm.trayId ? [detailsForm.trayId] : []}
                value={
                  detailsForm.trayId
                    ? trayOptions.find((option) => option.id === detailsForm.trayId)?.label ?? ''
                    : ''
                }
                onOptionSelect={handleDetailsTraySelect}
                disabled={!isAdmin || isLoadingTrays}
              >
                <Option value=''>No tray assigned</Option>
                {trayOptions.map((option) => (
                  <Option key={option.id} value={option.id}>
                    {option.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label='Description (optional)'>
              <Textarea
                value={detailsForm.description}
                onChange={handleDetailsChange('description')}
                rows={4}
                disabled={!isAdmin}
              />
            </Field>
            {isAdmin ? (
              <div className={styles.detailCardFooter}>
                <Button appearance='primary' type='submit' disabled={isSavingDetails}>
                  {isSavingDetails ? 'Saving...' : 'Save details'}
                </Button>
                <Button type='button' onClick={loadData} disabled={isSavingDetails}>
                  Reset
                </Button>
              </div>
            ) : (
              <Body2 className={styles.readOnlyNotice}>
                You can view details, but only administrators can make changes.
              </Body2>
            )}
          </form>
        </Card>

        <Card appearance='outline' className={styles.detailCard}>
          <Title3>Curve preview</Title3>
          <LoadCurveChart points={loadCurve.points} className={styles.chart} />
          <Caption1>
            {loadCurve.points.length} {loadCurve.points.length === 1 ? 'point' : 'points'}{' '}
            {'\u2022'}{' '}
            {loadCurve.trayType ? `Tray: ${loadCurve.trayType}` : 'No tray assigned'}
          </Caption1>
        </Card>
      </div>

      <div className={styles.pointsSection}>
        <div className={styles.pointsHeader}>
          <Title3>Curve points</Title3>
          <div className={styles.pointsActions}>
            {isAdmin ? (
              <>
                <Button onClick={handleAddPoint}>Add point</Button>
                <Button onClick={handleResetPoints} disabled={isSavingPoints}>
                  Reset to saved points
                </Button>
                <Button
                  appearance='primary'
                  onClick={handleImportClick}
                  disabled={isImportingPoints}
                >
                  {isImportingPoints ? 'Importing...' : 'Import from Excel'}
                </Button>
              </>
            ) : null}
            <input
              ref={importInputRef}
              type='file'
              accept='.xlsx'
              className={styles.hiddenInput}
              onChange={handleImportChange}
            />
          </div>
        </div>

        <div className={styles.pointsTableWrapper}>
          <table className={styles.pointsTable}>
            <thead>
              <tr>
                <th className={styles.pointsHeadCell}>#</th>
                <th className={styles.pointsHeadCell}>Support spacing L (m)</th>
                <th className={styles.pointsHeadCell}>Load q (kN/m)</th>
                {isAdmin ? <th className={styles.pointsHeadCell}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {pointsForm.length === 0 ? (
                <tr>
                  <td className={styles.pointsCell} colSpan={isAdmin ? 4 : 3}>
                    No points defined. {isAdmin ? 'Add a point to get started.' : null}
                  </td>
                </tr>
              ) : (
                pointsForm.map((row, index) => (
                  <tr key={row.id ?? `point-${index}`}>
                    <td className={styles.pointsCell}>{index + 1}</td>
                    <td className={styles.pointsCell}>
                      <Input
                        value={row.spanM}
                        onChange={handlePointFieldChange(index, 'spanM')}
                        disabled={!isAdmin}
                      />
                    </td>
                    <td className={styles.pointsCell}>
                      <Input
                        value={row.loadKnPerM}
                        onChange={handlePointFieldChange(index, 'loadKnPerM')}
                        disabled={!isAdmin}
                      />
                    </td>
                    {isAdmin ? (
                      <td className={styles.pointsCell}>
                        <Button
                          appearance='secondary'
                          onClick={() => handleRemovePoint(index)}
                        >
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pointsError ? <Body2 className={styles.errorText}>{pointsError}</Body2> : null}
        {isAdmin ? (
          <div className={styles.headerActions}>
            <Button
              appearance='primary'
              onClick={handlePointsSave}
              disabled={isSavingPoints || pointsForm.length === 0}
            >
              {isSavingPoints ? 'Saving...' : 'Save points'}
            </Button>
          </div>
        ) : (
          <Body2 className={styles.readOnlyNotice}>
            You can review the curve points, but only administrators can update them.
          </Body2>
        )}
      </div>
    </section>
  );
};












