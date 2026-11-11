import { useState } from 'react';
import { Button, Input } from '@fluentui/react-components';

export type TrayPurposeManagement = {
  busy: boolean;
  error: string | null;
  counts: Record<string, number>;
  create: (name: string) => Promise<boolean>;
  rename: (name: string, nextName: string) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
};

export function AddTrayPurpose({ management, disabled }: { management: TrayPurposeManagement; disabled: boolean }) {
  const [name, setName] = useState('');
  return <div>
    <Input aria-label="New tray purpose" placeholder="New tray purpose" value={name} maxLength={200}
      disabled={disabled || management.busy} onChange={(_, data) => setName(data.value)} />
    <Button disabled={disabled || management.busy || !name.trim()} onClick={() => {
      void management.create(name.trim().normalize('NFC')).then(saved => { if (saved) setName(''); });
    }}>Add purpose</Button>
    {management.error ? <p role="alert">{management.error}</p> : null}
  </div>;
}

export function TrayPurposeNameEditor({ name, management, disabled }: {
  name: string; management: TrayPurposeManagement; disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const count = management.counts[name] ?? 0;
  return <div>
    {editing ? <>
      <Input aria-label={`Rename tray purpose ${name}`} value={draft} maxLength={200}
        disabled={disabled || management.busy} onChange={(_, data) => setDraft(data.value)} />
      <Button disabled={disabled || management.busy || !draft.trim() || draft.trim() === name}
        onClick={() => { void management.rename(name, draft.trim().normalize('NFC')).then(saved => { if (saved) setEditing(false); }); }}>Save name</Button>
      <Button disabled={management.busy} onClick={() => { setDraft(name); setEditing(false); }}>Cancel</Button>
      <p>Renaming updates assigned trays and retains the template and permissions.</p>
    </> : <>
      <span>{name}</span>{' '}
      <Button disabled={disabled || management.busy} onClick={() => setEditing(true)}>Rename</Button>
      <Button disabled={disabled || management.busy || count > 0}
        title={count > 0 ? `Reassign ${count} trays before deleting this purpose.` : 'Delete unused purpose'}
        onClick={() => { void management.remove(name); }}>Delete</Button>
      <p>{count} assigned trays</p>
    </>}
  </div>;
}
