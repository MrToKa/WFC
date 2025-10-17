import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Field,
  Input,
  Spinner,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  Project,
  Tray,
  TrayInput,
  fetchProject,
  fetchTray,
  deleteTray,
  updateTray
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '60rem',
    width: '100%',
    margin: '0 auto',
    ...shorthands.padding('2rem', '1.5rem', '4rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  section: {
    display: 'grid',
    gap: '0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1.25rem')
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
    gap: '0.75rem'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  }
});

type TrayFormState = {
  name: string;
  type: string;
  purpose: string;
  widthMm: string;
  heightMm: string;
  lengthMm: string;
};

type TrayFormErrors = Partial<Record<keyof TrayFormState, string>>;

const toTrayFormState = (tray: Tray): TrayFormState => ({
  name: tray.name,
  type: tray.type ?? '',
  purpose: tray.purpose ?? '',
  widthMm: tray.widthMm !== null ? String(tray.widthMm) : '',
  heightMm: tray.heightMm !== null ? String(tray.heightMm) : '',
  lengthMm: tray.lengthMm !== null ? String(tray.lengthMm) : ''
});

const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }
  const normalised = trimmed.replace(',', '.');
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { numeric: null, error: 'Enter a valid non-negative number' };
  }
  return { numeric: parsed };
};

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const TrayDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, trayId } = useParams<{ projectId: string; trayId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);

  const [project, setProject] = useState<Project | null>(null);
  const [tray, setTray] = useState<Tray | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [formValues, setFormValues] = useState<TrayFormState>({
    name: '',
    type: '',
    purpose: '',
    widthMm: '',
    heightMm: '',
    lengthMm: ''
  });
  const [formErrors, setFormErrors] = useState<TrayFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    const load = async () => {
      if (!projectId || !trayId) {
        setError('Tray not found.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [projectResponse, trayResponse] = await Promise.all([
          fetchProject(projectId),
          fetchTray(projectId, trayId)
        ]);

        setProject(projectResponse.project);
        setTray(trayResponse.tray);
        setFormValues(toTrayFormState(trayResponse.tray));
      } catch (err) {
        console.error('Failed to load tray details', err);
        if (err instanceof ApiError && err.status === 404) {
          setError('Tray not found.');
        } else {
          setError('Failed to load tray details.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [projectId, trayId]);

  const pageTitle = useMemo(() => {
    if (!tray) {
      return 'Tray details';
    }
    return `Tray — ${tray.name}`;
  }, [tray]);

  const handleFieldChange =
    (field: keyof TrayFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setFormValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const buildTrayInput = (values: TrayFormState) => {
    const errors: TrayFormErrors = {};

    const name = values.name.trim();
    if (name === '') {
      errors.name = 'Name is required';
    }

    const widthResult = parseNumberInput(values.widthMm);
    if (widthResult.error) {
      errors.widthMm = widthResult.error;
    }

    const heightResult = parseNumberInput(values.heightMm);
    if (heightResult.error) {
      errors.heightMm = heightResult.error;
    }

    const lengthResult = parseNumberInput(values.lengthMm);
    if (lengthResult.error) {
      errors.lengthMm = lengthResult.error;
    }

    const input: TrayInput = {
      name,
      type: toNullableString(values.type),
      purpose: toNullableString(values.purpose),
      widthMm: widthResult.numeric,
      heightMm: heightResult.numeric,
      lengthMm: lengthResult.numeric
    };

    return { input, errors };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!project || !tray || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to update trays.'
      });
      return;
    }

    const { input, errors } = buildTrayInput(formValues);

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      const response = await updateTray(token, project.id, tray.id, input);
      setTray(response.tray);
      setFormValues(toTrayFormState(response.tray));
      setIsEditing(false);
      showToast({ intent: 'success', title: 'Tray updated' });
    } catch (err) {
      console.error('Update tray failed', err);
      showToast({
        intent: 'error',
        title: 'Failed to update tray',
        body: err instanceof ApiError ? err.message : undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!project || !tray || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to delete trays.'
      });
      return;
    }

    const confirmed = window.confirm(
      `Delete tray "${tray.name}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);

    try {
      await deleteTray(token, project.id, tray.id);
      showToast({ intent: 'success', title: 'Tray deleted' });
      navigate(`/projects/${project.id}?tab=trays`);
    } catch (err) {
      console.error('Delete tray failed', err);
      showToast({
        intent: 'error',
        title: 'Failed to delete tray',
        body: err instanceof ApiError ? err.message : undefined
      });
      setIsDeleting(false);
    }
  }, [project, tray, token, navigate, showToast]);

  const handleCancelEdit = () => {
    if (tray) {
      setFormValues(toTrayFormState(tray));
    }
    setFormErrors({});
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading tray..." />
      </section>
    );
  }

  if (error || !tray || !projectId || !trayId) {
    return (
      <section className={styles.root}>
        <Body1 className={styles.errorText}>{error ?? 'Tray not available.'}</Body1>
        <Button onClick={() => navigate(-1)}>Back</Button>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <Title3>{pageTitle}</Title3>
        {project ? (
          <Body1>
            Project: {project.projectNumber} — {project.name}
          </Body1>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button onClick={() => navigate(`/projects/${projectId}?tab=trays`)}>
          Back to project
        </Button>
        {isAdmin ? (
          <>
            {!isEditing ? (
              <Button appearance="primary" onClick={() => setIsEditing(true)}>
                Edit tray
              </Button>
            ) : null}
            <Button
              appearance="secondary"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete tray'}
            </Button>
          </>
        ) : null}
      </div>

      <div className={styles.section}>
        <Caption1>Tray details</Caption1>
        {isEditing ? (
          <form className={styles.grid} onSubmit={handleSubmit}>
            <Field
              label="Name"
              required
              validationState={formErrors.name ? 'error' : undefined}
              validationMessage={formErrors.name}
            >
              <Input
                value={formValues.name}
                onChange={handleFieldChange('name')}
                required
              />
            </Field>
            <Field
              label="Type"
              validationState={formErrors.type ? 'error' : undefined}
              validationMessage={formErrors.type}
            >
              <Input
                value={formValues.type}
                onChange={handleFieldChange('type')}
              />
            </Field>
            <Field
              label="Purpose"
              validationState={formErrors.purpose ? 'error' : undefined}
              validationMessage={formErrors.purpose}
            >
              <Input
                value={formValues.purpose}
                onChange={handleFieldChange('purpose')}
              />
            </Field>
            <Field
              label="Width [mm]"
              validationState={formErrors.widthMm ? 'error' : undefined}
              validationMessage={formErrors.widthMm}
            >
              <Input
                value={formValues.widthMm}
                onChange={handleFieldChange('widthMm')}
              />
            </Field>
            <Field
              label="Height [mm]"
              validationState={formErrors.heightMm ? 'error' : undefined}
              validationMessage={formErrors.heightMm}
            >
              <Input
                value={formValues.heightMm}
                onChange={handleFieldChange('heightMm')}
              />
            </Field>
            <Field
              label="Length"
              validationState={formErrors.lengthMm ? 'error' : undefined}
              validationMessage={formErrors.lengthMm}
            >
              <Input
                value={formValues.lengthMm}
                onChange={handleFieldChange('lengthMm')}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                type="button"
                appearance="secondary"
                onClick={handleCancelEdit}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        ) : (
          <div className={styles.grid}>
            <div className={styles.field}>
              <Caption1>Name</Caption1>
              <Body1>{tray.name}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Type</Caption1>
              <Body1>{tray.type ?? '-'}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Purpose</Caption1>
              <Body1>{tray.purpose ?? '-'}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Width [mm]</Caption1>
              <Body1>
                {tray.widthMm !== null
                  ? new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 3
                    }).format(tray.widthMm)
                  : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Height [mm]</Caption1>
              <Body1>
                {tray.heightMm !== null
                  ? new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 3
                    }).format(tray.heightMm)
                  : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Length</Caption1>
              <Body1>
                {tray.lengthMm !== null
                  ? new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 3
                    }).format(tray.lengthMm)
                  : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Created</Caption1>
              <Body1>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                }).format(new Date(tray.createdAt))}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Updated</Caption1>
              <Body1>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                }).format(new Date(tray.updatedAt))}
              </Body1>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
