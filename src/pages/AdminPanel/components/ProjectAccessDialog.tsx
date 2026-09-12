import { useEffect, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from '@fluentui/react-components';
import { useAuth } from '@/context/AuthContext';
import { fetchProjects, type Project, type User } from '@/api/client';
import { request } from '@/api/http';

export const ProjectAccessDialog = ({ user, onClose, onSaved }: {
  user: User; onClose: () => void; onSaved: () => void;
}) => {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string[]>(user.engineerProjectIds ?? []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    fetchProjects().then((response) => { if (current) setProjects(response.projects); })
      .catch(() => { if (current) setError('Unable to load projects. Close and try again.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);
  const save = async () => {
    if (!token) return;
    setSaving(true); setError(null);
    try {
      await request(`/api/admin/users/${user.id}/project-access`, { token, method: 'PUT', body: { projectIds: selected } });
      onSaved(); onClose();
    } catch { setError('Unable to save project assignments. Reload and try again.'); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !saving) onClose(); }}>
    <DialogSurface><DialogBody><DialogTitle>Project engineer access — {user.email}</DialogTitle>
      <DialogContent>
        <p>Allow editing and import/export of project cables, cable types, materials, trays, supports, Change Orders and Internal NCR. Main project settings, the shared catalog and engineering approval remain administrator-only. Clear all assignments to remove engineer access.</p>
        {loading ? <Spinner label="Loading projects" /> : projects.map((project) => <div key={project.id}>
          <Checkbox label={`${project.projectNumber} — ${project.name}`} checked={selected.includes(project.id)} disabled={saving}
            onChange={(_, data) => setSelected((old) => data.checked ? [...old, project.id] : old.filter((id) => id !== project.id))} />
        </div>)}
        {error ? <p role="alert">{error}</p> : null}
      </DialogContent>
      <DialogActions><Button disabled={saving} onClick={onClose}>Cancel</Button>
        <Button appearance="primary" disabled={loading || saving || (projects.length === 0 && Boolean(error))} onClick={() => void save()}>{saving ? 'Saving...' : 'Save project access'}</Button>
      </DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>;
};
