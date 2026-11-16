import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, FluentProvider, Option, Tab, TabList, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPanelOpenButton, ControlPanelPart, ControlPanelWindow } from './ControlPanelWindow';

const frames: HTMLIFrameElement[] = [];
function popupWindow() {
  const iframe = document.createElement('iframe'); document.body.appendChild(iframe); frames.push(iframe);
  const child = iframe.contentWindow!;
  Object.defineProperty(child, 'closed', { configurable: true, writable: true, value: false });
  child.focus = vi.fn();
  child.close = vi.fn(() => {
    Object.defineProperty(child, 'closed', { configurable: true, writable: true, value: true });
    const event = child.document.createEvent('Event'); event.initEvent('beforeunload', false, false); child.dispatchEvent(event);
  });
  return child;
}

const sections = ['Details', 'Cable types', 'Cables list', 'Routings builder', 'Path Finder', 'Trays', 'Cables MTOs', 'Change Orders', 'Internal NCRs', 'Roxtec', 'Files', 'Variables API'];

function Fields({ onMount }: { onMount: () => void }) {
  const [draft, setDraft] = useState('initial draft');
  const [mode, setMode] = useState('Routes');
  useEffect(onMount, [onMount]);
  return <div data-testid="sidebar">
    <ControlPanelOpenButton />
    <TabList aria-label="Path Finder tools" selectedValue={mode} onTabSelect={(_, data) => setMode(String(data.value))}>
      {['Routes', 'Path', 'Path lookup'].map(tool => <Tab key={tool} value={tool}>{tool}</Tab>)}
    </TabList>
    <input aria-label="Controlled draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <input aria-label="Uncontrolled draft" defaultValue="initial browser value" />
  </div>;
}

function DialogDraft() {
  const [draft, setDraft] = useState('initial dialog value');
  return <input aria-label="Dialog draft" value={draft} onChange={event => setDraft(event.target.value)} />;
}

function Content() {
  const [draft, setDraft] = useState('body draft');
  const [dialogOpen, setDialogOpen] = useState(false);
  return <div data-testid="body-section">
    <input aria-label="Body draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <Dropdown aria-label="Purpose" placeholder="Choose purpose"><Option>Lighting</Option><Option>Power</Option></Dropdown>
    <Button onClick={() => setDialogOpen(true)}>Edit in dialog</Button>
    <Dialog open={dialogOpen}>
      <DialogSurface><DialogBody>
        <DialogTitle>Edit cable</DialogTitle>
        <DialogContent><DialogDraft /></DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Close dialog</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </div>;
}

function Harness({ onMount = () => undefined, dark = false }: { onMount?: () => void; dark?: boolean }) {
  const [selected, setSelected] = useState('Path Finder');
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}
    style={{ backgroundColor: dark ? '#292929' : '#ffffff', color: dark ? '#ffffff' : '#242424', fontFamily: 'Segoe UI' }}>
    <ControlPanelWindow scopeKey={JSON.stringify(['project-session-account', selected])} enabled={selected === 'Path Finder' || selected === 'Routings builder'} actionsInPanel>
      {detached => <>
        <ControlPanelPart order={0} inlineOnly>
          <TabList aria-label="Project sections" selectedValue={selected} onTabSelect={(_, data) => setSelected(String(data.value))}>
            {sections.map(section => <Tab key={section} value={section}>{section}</Tab>)}
          </TabList>
          <span data-testid="selected-section">{selected}</span>
        </ControlPanelPart>
        <div data-testid="viewer-frame" data-detached={detached}>
          <iframe title="Stable 3D model" />
        </div>
        <ControlPanelPart order={1}><Fields onMount={onMount} /></ControlPanelPart>
        <ControlPanelPart order={2}><Content /></ControlPanelPart>
      </>}
    </ControlPanelWindow>
  </FluentProvider>;
}

afterEach(() => {
  cleanup(); frames.splice(0).forEach(frame => frame.remove());
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('ControlPanelWindow integration', () => {
  it.each(sections)('closes on navigation and restricts the popup action in %s', selected => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />);
    const draft = screen.getByLabelText('Controlled draft') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'unsaved before tab switch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    fireEvent.click(screen.getByRole('tab', { name: selected }));
    const supported = selected === 'Path Finder' || selected === 'Routings builder';
    expect(screen.queryByRole('button', { name: 'Pop-up control panel' }) !== null).toBe(supported);
    if (selected !== 'Path Finder') {
      expect(popup.close).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: 'Return to main window' })).toBeNull();
      expect(screen.getByLabelText('Controlled draft')).toBe(draft);
      expect(draft.value).toBe('unsaved before tab switch');
      expect(draft.ownerDocument).toBe(document);
    } else expect(popup.close).not.toHaveBeenCalled();
  });

  it('keeps project navigation and the viewer in the main window while moving controls and preserving drafts', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const mounted = vi.fn(); render(<Harness onMount={mounted} />);
    const sidebar = screen.getByTestId('sidebar'), body = screen.getByTestId('body-section');
    const viewer = screen.getByTestId('viewer-frame'), frame = screen.getByTitle('Stable 3D model');
    const frameParent = frame.parentNode;
    const controlled = screen.getByLabelText('Controlled draft') as HTMLInputElement;
    fireEvent.change(controlled, { target: { value: 'unsaved assignment' } });
    fireEvent.change(screen.getByLabelText('Uncontrolled draft'), { target: { value: 'browser-local draft' } });
    fireEvent.change(screen.getByLabelText('Body draft'), { target: { value: 'unsaved settings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    const child = within(popup.document.body);
    for (const section of sections) {
      expect(screen.getByRole('tab', { name: section })).toBeDefined();
      expect(child.queryByRole('tab', { name: section })).toBeNull();
    }
    for (const tool of ['Routes', 'Path', 'Path lookup']) expect(child.getByRole('tab', { name: tool })).toBeDefined();
    expect(child.getByTestId('sidebar')).toBe(sidebar); expect(child.getByTestId('body-section')).toBe(body);
    expect(child.getByLabelText('Controlled draft')).toBe(controlled);
    expect(controlled.value).toBe('unsaved assignment');
    expect((child.getByLabelText('Uncontrolled draft') as HTMLInputElement).value).toBe('browser-local draft');
    expect((child.getByLabelText('Body draft') as HTMLInputElement).value).toBe('unsaved settings');
    expect(screen.getByTestId('viewer-frame')).toBe(viewer);
    expect(frame.ownerDocument).toBe(document); expect(frame.parentNode).toBe(frameParent);
    expect(popup.document.querySelector('iframe')).toBeNull();
    fireEvent.change(controlled, { target: { value: 'edited in separate window' } });
    expect(screen.getByTestId('selected-section').textContent).toBe('Path Finder');
    expect(child.getByTestId('sidebar')).toBe(sidebar);
    expect(child.getByLabelText('Controlled draft')).toBe(controlled);
    fireEvent.click(child.getByRole('tab', { name: 'Path lookup' }));
    expect(child.getByRole('tab', { name: 'Path lookup' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(child.getByRole('button', { name: 'Return to main window' }));
    expect(screen.getByTestId('sidebar')).toBe(sidebar);
    expect(screen.getByTestId('body-section')).toBe(body);
    expect(screen.getByLabelText('Controlled draft')).toBe(controlled);
    expect(controlled.value).toBe('edited in separate window');
    expect(screen.getByLabelText('Uncontrolled draft')).toHaveValue('browser-local draft');
    expect(screen.getByTestId('selected-section')).toHaveTextContent('Path Finder');
    expect(screen.getByRole('tab', { name: 'Path lookup' })).toHaveAttribute('aria-selected', 'true');
    expect(mounted).toHaveBeenCalledOnce();
    expect(frame.parentNode).toBe(frameParent); expect(frame.ownerDocument).toBe(document);
  });

  it('returns the mounted controls on native window close without losing edits', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const mounted = vi.fn(); render(<Harness onMount={mounted} />);
    const original = screen.getByTestId('sidebar');
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    const child = within(popup.document.body);
    fireEvent.change(child.getByLabelText('Controlled draft'), { target: { value: 'not saved' } });
    fireEvent.click(child.getByRole('button', { name: 'Edit in dialog' }));
    fireEvent.change(child.getByLabelText('Dialog draft'), { target: { value: 'dialog pending native close' } });
    act(() => popup.close());
    expect(screen.getByTestId('sidebar')).toBe(original);
    expect(screen.getByLabelText('Controlled draft')).toHaveValue('not saved');
    expect((screen.getByLabelText('Dialog draft') as HTMLInputElement).value).toBe('dialog pending native close');
    expect(mounted).toHaveBeenCalledOnce();
    expect(screen.getByTitle('Stable 3D model').ownerDocument).toBe(document);
  });

  it('renders child Fluent dialogs and dropdown options in the popup document', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    const child = within(popup.document.body);
    fireEvent.click(child.getByRole('combobox', { name: 'Purpose' }));
    expect(child.getByRole('listbox')).toBeDefined();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    fireEvent.click(child.getByRole('option', { name: 'Lighting' }));
    fireEvent.click(child.getByRole('button', { name: 'Edit in dialog' }));
    expect(child.getByRole('dialog')).toBeDefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.change(child.getByLabelText('Dialog draft'), { target: { value: 'unsaved dialog draft' } });
    expect((child.getByLabelText('Dialog draft') as HTMLInputElement).value).toBe('unsaved dialog draft');
  });

  it('preserves an open dialog local draft when detaching and returning', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Edit in dialog' }));
    fireEvent.change(screen.getByLabelText('Dialog draft'), { target: { value: 'unsaved before detaching' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    const child = within(popup.document.body);
    expect(document.querySelector('[aria-label="Dialog draft"]')).toBeNull();
    expect((child.getByLabelText('Dialog draft') as HTMLInputElement).value).toBe('unsaved before detaching');
    fireEvent.change(child.getByLabelText('Dialog draft'), { target: { value: 'unsaved before returning' } });
    fireEvent.click(child.getByRole('button', { name: 'Return to main window' }));
    expect(screen.getByLabelText('Dialog draft')).toHaveValue('unsaved before returning');
  });

  it('retains focused input selection and scrolled control positions through the round trip', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />);
    const input = screen.getByLabelText('Controlled draft') as HTMLInputElement;
    const sidebar = screen.getByTestId('sidebar');
    fireEvent.change(input, { target: { value: 'remember my selection' } });
    input.focus(); input.setSelectionRange(2, 8, 'backward');
    sidebar.scrollTop = 120; sidebar.scrollLeft = 25;
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    expect(popup.document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 8, 'backward']);
    expect([sidebar.scrollTop, sidebar.scrollLeft]).toEqual([120, 25]);
    input.setSelectionRange(4, 11, 'forward'); sidebar.scrollTop = 240; sidebar.scrollLeft = 40;
    fireEvent.click(within(popup.document.body).getByRole('button', { name: 'Return to main window' }));
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([4, 11, 'forward']);
    expect([sidebar.scrollTop, sidebar.scrollLeft]).toEqual([240, 40]);
  });

  it('leaves all navigation and drafts inline if the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Harness />); const original = screen.getByTestId('sidebar');
    fireEvent.change(screen.getByLabelText('Controlled draft'), { target: { value: 'pending work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    expect(screen.getByRole('status')).toHaveTextContent('Allow pop-ups for this site');
    expect(screen.getByTestId('sidebar')).toBe(original);
    expect(screen.getByLabelText('Controlled draft')).toHaveValue('pending work');
    for (const section of sections) expect(screen.getByRole('tab', { name: section })).toBeDefined();
  });

  it('keeps popup body background and text readable when switching between dark and light themes', async () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const view = render(<Harness dark />);
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    expect(popup.document.body.style.backgroundColor).toBe('rgb(41, 41, 41)');
    expect(popup.document.body.style.color).toBe('rgb(255, 255, 255)');
    expect(popup.document.body.style.fontFamily).toContain('Segoe UI');
    const draft = within(popup.document.body).getByLabelText('Controlled draft') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'keep through theme changes' } });
    await act(async () => view.rerender(<Harness dark={false} />));
    expect(popup.document.body.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(popup.document.body.style.color).toBe('rgb(36, 36, 36)');
    expect(within(popup.document.body).getByLabelText('Controlled draft')).toBe(draft);
    expect(draft.value).toBe('keep through theme changes');
  });
});
