import { useEffect, useRef, useState } from 'react';
import { Body1, Button, MessageBar, MessageBarBody, Spinner, Title2, makeStyles, tokens } from '@fluentui/react-components';
import { openPreparerSession } from '@/api/preparer';
import { useAuth } from '@/context/AuthContext';

const useStyles = makeStyles({ root: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: tokens.spacingVerticalL, maxWidth: '44rem' } });
export const SimplifiedPreparer = () => {
  const styles = useStyles(), { user, token } = useAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [url, setUrl] = useState<string | null>(null);
  const accountIdentity = `${token ?? ''}:${user?.id ?? ''}:${user?.isAdmin === true}`;
  const pending = useRef<AbortController | null>(null), identity = useRef(accountIdentity), alive = useRef(true);
  identity.current = accountIdentity;
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => { pending.current?.abort(); setUrl(null); setError(null); setBusy(false); }, [accountIdentity]);
  const launch = async () => {
    if (!token || user?.isAdmin !== true || busy) return;
    const requestToken = token, requestIdentity = accountIdentity, controller = new AbortController(); pending.current = controller; setBusy(true); setError(null); setUrl(null);
    // Open during the click gesture; the server verifies access before navigation.
    let target: Window | null = null; try { target = window.open('about:blank', '_blank'); if (target) target.opener = null; } catch { /* A link remains available when popups are blocked. */ }
    try {
      const result = await openPreparerSession(requestToken, controller.signal);
      if (!alive.current || identity.current !== requestIdentity || controller.signal.aborted) { target?.close(); return; }
      setUrl(result.url); if (target && !target.closed) target.location.replace(result.url);
    } catch (failure) {
      target?.close(); if (alive.current && identity.current === requestIdentity && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The model preparer could not be opened.');
    } finally { if (alive.current && identity.current === requestIdentity) { setBusy(false); pending.current = null; } }
  };
  return <section className={styles.root} aria-labelledby="preparer-heading">
    <Title2 id="preparer-heading">Model preparer</Title2>
    {user?.isAdmin !== true ? <Body1>A current WFC administrator account is required.</Body1> : <>
      <Body1>Prepare a 3D model and save it to a WFC project. The preparer opens in a separate tab using your current WFC account.</Body1>
      <Body1>Manage your Autodesk connection in the preparer. Keep that page open while working.</Body1>
      <Button appearance="primary" disabled={busy || !token} onClick={() => { void launch(); }}>Open model preparer</Button>
      {busy ? <Spinner size="small" label="Opening model preparer..." /> : null}
      {error ? <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar> : null}
      {url ? <Body1>If the new tab did not open, <a href={url} target="_blank" rel="noopener noreferrer">continue to the model preparer</a>.</Body1> : null}
    </>}
  </section>;
};
