import { useState, type FormEvent } from 'react';
import {
  Body1,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { clearProjectData, deleteProject, updateProject, type Project } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { canEditProject } from '@/utils/permissions';

export const ProjectActions = ({ project, onSaved }: { project: Project; onSaved: () => void }) => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'edit' | 'clear' | 'delete' | null>(null);
  const [values, setValues] = useState({
    projectNumber: '',
    name: '',
    customer: '',
    manager: '',
    description: '',
  });
  const [selection, setSelection] = useState({ cableTypes: false, cables: false, trays: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canEditProject(user, project) || !token) return null;

  const open = (next: typeof mode) => {
    setValues({
      projectNumber: project.projectNumber,
      name: project.name,
      customer: project.customer,
      manager: project.manager ?? '',
      description: project.description ?? '',
    });
    setSelection({ cableTypes: false, cables: false, trays: false });
    setError(null);
    setMode(next);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditProject(user, project) || !token || !mode) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'edit') {
        await updateProject(token, project.id, {
          projectNumber: values.projectNumber.trim(),
          name: values.name.trim(),
          customer: values.customer.trim(),
          manager: values.manager.trim() || null,
          description: values.description.trim(),
        });
      } else if (mode === 'clear') {
        await clearProjectData(token, project.id, selection);
      } else {
        await deleteProject(token, project.id);
        navigate('/', { replace: true });
        return;
      }
      setMode(null);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to update project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Button onClick={() => open('edit')}>Edit project</Button>
        <Button onClick={() => open('clear')}>Clear project data</Button>
        <Button onClick={() => open('delete')}>Delete project</Button>
      </div>
      <Dialog
        open={mode !== null}
        onOpenChange={(_, data) => {
          if (!data.open && !saving) setMode(null);
        }}
      >
        <DialogSurface>
          <form onSubmit={(event) => void submit(event)}>
            <DialogBody>
              <DialogTitle>
                {mode === 'edit'
                  ? 'Edit project'
                  : mode === 'clear'
                    ? 'Clear project data'
                    : 'Delete project'}
              </DialogTitle>
              <DialogContent>
                {mode === 'edit' ? (
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {(['projectNumber', 'name', 'customer', 'manager'] as const).map((field) => (
                      <Field
                        key={field}
                        label={
                          {
                            projectNumber: 'Project number',
                            name: 'Name',
                            customer: 'Customer',
                            manager: 'Manager',
                          }[field]
                        }
                        required={field !== 'manager'}
                      >
                        <Input
                          value={values[field]}
                          required={field !== 'manager'}
                          disabled={saving}
                          onChange={(_, data) =>
                            setValues((previous) => ({ ...previous, [field]: data.value }))
                          }
                        />
                      </Field>
                    ))}
                    <Field label="Description">
                      <Textarea
                        value={values.description}
                        disabled={saving}
                        onChange={(_, data) =>
                          setValues((previous) => ({ ...previous, description: data.value }))
                        }
                      />
                    </Field>
                  </div>
                ) : mode === 'clear' ? (
                  <>
                    <Body1>
                      Selected data will be permanently deleted. Clearing cable types also removes
                      their cables.
                    </Body1>
                    {(['cableTypes', 'cables', 'trays'] as const).map((field) => (
                      <Checkbox
                        key={field}
                        label={
                          { cableTypes: 'Cable types', cables: 'Cables', trays: 'Trays' }[field]
                        }
                        checked={selection[field]}
                        disabled={saving}
                        onChange={(_, data) =>
                          setSelection((previous) => ({
                            ...previous,
                            [field]: data.checked === true,
                          }))
                        }
                      />
                    ))}
                  </>
                ) : (
                  <Body1>
                    Delete {project.projectNumber} and all its project data? This cannot be undone.
                  </Body1>
                )}
                {error ? <p role="alert">{error}</p> : null}
              </DialogContent>
              <DialogActions>
                <Button type="button" disabled={saving} onClick={() => setMode(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={saving || (mode === 'clear' && !Object.values(selection).some(Boolean))}
                >
                  {saving
                    ? 'Saving...'
                    : mode === 'edit'
                      ? 'Save project'
                      : mode === 'clear'
                        ? 'Confirm clear'
                        : 'Confirm delete'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </>
  );
};
