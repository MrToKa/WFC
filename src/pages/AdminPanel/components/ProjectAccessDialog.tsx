import { useEffect, useState } from 'react';
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
  Spinner,
} from '@fluentui/react-components';
import {
  type Project,
  type User,
  fetchProjects,
  fetchUserProjectAccess,
  updateUserProjectAccess,
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';

export const ProjectAccessDialog = ({ user, onClose }: { user: User; onClose: () => void }) => {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError(null);
    if (!token) {
      setLoading(false);
      setError('Authentication required.');
      return;
    }
    Promise.all([fetchProjects(), fetchUserProjectAccess(token, user.id)])
      .then(([catalog, access]) => {
        if (!active) return;
        setProjects(catalog.projects);
        setSelected(access.projectIds);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setError('Failed to load project access. Close and try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, user.id]);

  const save = async () => {
    if (!token || !loaded || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateUserProjectAccess(token, user.id, selected);
      onClose();
    } catch {
      setError('Failed to save project access. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !saving) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Project access</DialogTitle>
          <DialogContent>
            <Body1>{user.email}</Body1>
            <p>
              {user.role === 'engineer'
                ? 'Select projects this Engineer may edit. Other projects remain available for reading and table export.'
                : 'Select projects this user may view. Clearing all projects removes their project access.'}
            </p>
            {loading ? <Spinner label="Loading project access..." /> : null}
            {error ? <p role="alert">{error}</p> : null}
            {loaded && !projects.length ? <p>No projects available.</p> : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '50vh',
                overflowY: 'auto',
              }}
            >
              {loaded
                ? projects.map((project) => (
                    <Checkbox
                      key={project.id}
                      label={`${project.projectNumber} — ${project.name}`}
                      checked={selected.includes(project.id)}
                      disabled={saving}
                      onChange={(_, data) =>
                        setSelected((previous) =>
                          data.checked
                            ? [...previous, project.id]
                            : previous.filter((id) => id !== project.id),
                        )
                      }
                    />
                  ))
                : null}
            </div>
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              disabled={!loaded || loading || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving...' : 'Save access'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
