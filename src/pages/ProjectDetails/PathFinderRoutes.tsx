import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner } from '@fluentui/react-components';
import type { PathFinderCable } from '@/api/pathfinder';
import type { ViewerModelObject, ViewerModelObjectsPage } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Category = 'MV' | 'LV' | 'Control';
type Rule = { id: string; objectIds: number[]; allowedCategories: Category[]; names: string[] };
type Props = { pf: ReturnType<typeof usePathFinder>; active: boolean; selectedCable?: PathFinderCable; standaloneNames: string[]; onRulesDirtyChange: (dirty: boolean) => void };
const categories: Category[] = ['MV', 'LV', 'Control'];

/** Draft rules are scoped to this active model; the protected frame expands selected roots. */
export function PathFinderRoutes({ pf, active, selectedCable, standaloneNames, onRulesDirtyChange }: Props) {
  const styles = useRoutingsViewerStyles(), generation = useRef(0);
  const ruleRevision = useRef(0), modelScope = `${pf.data?.activeModel.modelVersionId ?? ''}:${pf.data?.activeModel.selectionRevision ?? ''}`, currentModelScope = useRef(modelScope); currentModelScope.current = modelScope;
  const [rules, setRules] = useState<Rule[]>([]), [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [preparedRules, setPreparedRules] = useState<Rule[]>([]), [dirty, setDirty] = useState(false), dirtyCallback = useRef(onRulesDirtyChange); dirtyCallback.current = onRulesDirtyChange;
  const [newCategories, setNewCategories] = useState<Category[]>(['LV', 'Control']), [working, setWorking] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState(''), [candidates, setCandidates] = useState<ViewerModelObjectsPage | null>(null), [checkedObjects, setCheckedObjects] = useState<ViewerModelObject[]>([]);
  const modelId = pf.data?.activeModel.modelVersionId, selectionRevision = pf.data?.activeModel.selectionRevision;
  useEffect(() => { generation.current++; setRules([]); setPreparedRules([]); setDirty(false); dirtyCallback.current(false); setSelectedRuleId(null); setWorking(false); setNotice(null); setCandidates(null); setCheckedObjects([]); }, [modelId, selectionRevision]);
  useEffect(() => { generation.current++; setWorking(false); setNotice(null); return () => { generation.current++; }; }, [active]);
  const markDirty = () => { ruleRevision.current++; setDirty(true); onRulesDirtyChange(true); };
  const saveObjects = (objects: ViewerModelObject[], replace: boolean) => {
    const objectIds = [...new Set(objects.map(object => object.objectId))];
    const existing = replace ? rules.find(rule => rule.id === selectedRuleId) : rules.find(rule => rule.objectIds.length === objectIds.length && rule.objectIds.every(id => objectIds.includes(id)));
    if (replace && !existing) { setNotice('Select a rule to update.'); return; }
    const next: Rule = { id: existing?.id ?? crypto.randomUUID(), objectIds, names: objects.map(object => object.name), allowedCategories: replace && existing ? existing.allowedCategories : [...newCategories] };
    const retained = rules.filter(rule => rule.id !== next.id);
    if (retained.length >= 100 || retained.reduce((count, rule) => count + rule.objectIds.length, objectIds.length) > 512) { setNotice('Use at most 100 rules and 512 selected root objects.'); return; }
    markDirty(); setRules([...retained, next]); setSelectedRuleId(next.id); setNotice('Selection saved as the newest rule. Later rules take precedence where selections overlap.');
  };
  const upsertSelection = async (replace: boolean) => {
    if (!active || pf.busy || working) return;
    const current = ++generation.current; setWorking(true); setNotice(null);
    try {
      const selection = await pf.readSelection();
      if (generation.current !== current) return;
      if (!selection?.objects.length) { setNotice('Select one or more model objects or groups, then add the selection.'); return; }
      saveObjects(selection.objects, replace);
    } finally { if (generation.current === current) setWorking(false); }
  };
  const search = async (cursor = 0) => {
    if (!active || !query.trim() || pf.busy || working) return;
    const current = ++generation.current; setWorking(true); setNotice(null);
    try { const result = await pf.readObjects(query, cursor); if (result && generation.current === current) setCandidates(result); }
    finally { if (generation.current === current) setWorking(false); }
  };
  const toggleRule = (id: string, category: Category, checked: boolean) => {
    markDirty();
    setRules(previous => {
      const rule = previous.find(value => value.id === id); if (!rule) return previous;
      const allowedCategories = checked ? categories.filter(value => value === category || rule.allowedCategories.includes(value)) : rule.allowedCategories.filter(value => value !== category);
      return [...previous.filter(value => value.id !== id), { ...rule, allowedCategories }];
    });
    setSelectedRuleId(id); setNotice('Category change saved as the newest rule. An empty category row excludes its selected objects.');
  };
  const prepare = async () => {
    if (!active || !rules.length || pf.busy || working) return;
    const cables = selectedCable ? [selectedCable] : pf.data?.cables ?? [];
    const equipmentNames = [...new Set([...standaloneNames, ...cables.flatMap(cable => [cable.fromLocation, cable.toLocation]).filter((value): value is string => Boolean(value?.trim())).map(value => value.trim())])];
    if (equipmentNames.length > 256 || equipmentNames.some(name => name.length > 256)) { setNotice('The equipment scope exceeds 256 names. Select one cable in Path to prepare its endpoint candidates.'); return; }
    const current = ++generation.current, capturedScope = currentModelScope.current, capturedRevision = ruleRevision.current;
    const capturedRules = rules.map(rule => ({ ...rule, objectIds: [...rule.objectIds], allowedCategories: [...rule.allowedCategories], names: [...rule.names] }));
    setWorking(true); setNotice(null);
    try {
      const result = await pf.prepareModel({ routeRules: capturedRules.map(({ id, objectIds, allowedCategories }) => ({ id, objectIds, allowedCategories })), equipmentNames });
      if (result && currentModelScope.current === capturedScope) {
        // A persisted snapshot remains authoritative even if its viewer work was cancelled meanwhile.
        setPreparedRules(capturedRules);
        if (ruleRevision.current === capturedRevision) { setRules(capturedRules); setDirty(false); onRulesDirtyChange(false); }
        else { setDirty(true); onRulesDirtyChange(true); }
        setNotice(generation.current === current ? 'All route rules were prepared. Review category assignments and locations before using calculated results.' : 'The snapshot was saved before cancellation completed. Its prepared rules were retained.');
      }
    } finally { if (generation.current === current) setWorking(false); }
  };
  return <section className={styles.result} aria-label="Route category rules">
    <h3>Route categories</h3>
    <Body1>Select model objects or groups, then assign the cable categories allowed on their routes.</Body1>
    <fieldset disabled={!active || pf.busy || working}><legend>Categories for a new selection</legend>
      {categories.map(category => <label key={category} style={{ display: 'block' }}><input type="checkbox" checked={newCategories.includes(category)} onChange={event => setNewCategories(previous => event.target.checked ? [...previous, category] : previous.filter(value => value !== category))} />{category}{category === 'Control' ? ' (including Instrumentation)' : ''}</label>)}
    </fieldset>
    <Caption1>Rules are ordered from oldest to newest. The newest matching rule wins. A rule with no checked category explicitly excludes its objects.</Caption1>
    <div className={styles.actions}>
      <Button disabled={!active || pf.viewerPhase !== 'ready' || pf.busy || working} onClick={() => void upsertSelection(false)}>Add current selection</Button>
      <Button disabled={!active || pf.viewerPhase !== 'ready' || !selectedRuleId || pf.busy || working} onClick={() => void upsertSelection(true)}>Update selected group</Button>
      <Button disabled={!rules.length || pf.busy || working} onClick={() => { markDirty(); setRules([]); setSelectedRuleId(null); setNotice('Draft rules cleared. Add and prepare new rules, or discard the draft to use the existing prepared snapshot.'); }}>Clear route rules</Button>
      <Button disabled={!dirty || pf.busy || working} onClick={() => { setRules(preparedRules); setDirty(false); onRulesDirtyChange(false); setSelectedRuleId(null); setNotice('Draft changes discarded. The last prepared snapshot is in use.'); }}>Discard route rule changes</Button>
    </div>
    <details><summary>Find route objects by name</summary>
      <Field label="Route object name"><Input aria-label="Route object query" maxLength={256} value={query} onChange={(_, input) => { setQuery(input.value); setCandidates(null); }} /></Field>
      <Button disabled={!active || pf.viewerPhase !== 'ready' || !query.trim() || pf.busy || working} onClick={() => void search()}>Find route objects</Button>
      {candidates?.objects.map(object => <label key={object.objectId} style={{ display: 'block' }}><input type="checkbox" aria-label={`Select ${object.name} (${object.objectId})`} checked={checkedObjects.some(value => value.objectId === object.objectId)} disabled={working || pf.busy || checkedObjects.length >= 512 && !checkedObjects.some(value => value.objectId === object.objectId)} onChange={event => setCheckedObjects(previous => event.target.checked ? [...previous, object] : previous.filter(value => value.objectId !== object.objectId))} />{object.name} — object {object.objectId}</label>)}
      {candidates && !candidates.objects.length ? <Caption1>No route objects found.</Caption1> : null}
      {candidates?.nextCursor != null ? <Button disabled={working || pf.busy} onClick={() => void search(candidates.nextCursor!)}>Next route objects</Button> : null}
      <Caption1>{checkedObjects.length} objects checked.</Caption1>
      <Button disabled={!checkedObjects.length || working || pf.busy} onClick={() => saveObjects(checkedObjects, false)}>Add checked objects as a rule</Button>
      <Button disabled={!checkedObjects.length || working || pf.busy} onClick={() => setCheckedObjects([])}>Clear checked objects</Button>
    </details>
    {working ? <Spinner size="tiny" label="Reading or preparing selected routes…" /> : null}
    {notice ? <Body1 role="status">{notice}</Body1> : null}
    <table className={styles.table} aria-label="Route category rule grid"><thead><tr><th scope="col">Selection</th>{categories.map(category => <th key={category} scope="col">{category}</th>)}<th scope="col">Action</th></tr></thead><tbody>
      {rules.map((rule, index) => <tr key={rule.id}>
        <td><Button appearance={selectedRuleId === rule.id ? 'secondary' : 'subtle'} aria-pressed={selectedRuleId === rule.id} onClick={() => setSelectedRuleId(rule.id)}>{index + 1}. {rule.names.join(', ')}</Button><Caption1>{rule.objectIds.length} selected {rule.objectIds.length === 1 ? 'root' : 'roots'}</Caption1></td>
        {categories.map(category => <td key={category}><input type="checkbox" aria-label={`${category} for rule ${index + 1}`} checked={rule.allowedCategories.includes(category)} disabled={pf.busy || working} onChange={event => toggleRule(rule.id, category, event.target.checked)} /></td>)}
        <td><Button aria-label={`Remove rule ${index + 1}`} disabled={pf.busy || working} onClick={() => { markDirty(); setRules(previous => previous.filter(value => value.id !== rule.id)); if (selectedRuleId === rule.id) setSelectedRuleId(null); }}>Remove</Button></td>
      </tr>)}
    </tbody></table>
    {!rules.length ? <Caption1>No route category rules yet.</Caption1> : null}
    {dirty ? <Body1 role="status">Route rules have unapplied changes. Prepare all rules or discard the draft before calculating or reviewing paths.</Body1> : null}
    <Button appearance="primary" disabled={!active || pf.viewerPhase !== 'ready' || !rules.length || pf.busy || working} onClick={() => void prepare()}>Prepare routes from all rules</Button>
    {working ? <Button onClick={() => { generation.current++; pf.cancelOperation(); setWorking(false); setNotice('Viewer preparation cancelled. A snapshot already being saved will be retained when its save finishes.'); }}>Cancel route preparation</Button> : null}
    <Caption1>Preparation includes the named From/To endpoints entered in Path and the project cable endpoint names. Selection rules reset when the active model version or its selection revision changes. Only the explicitly selected route network is prepared.</Caption1>
  </section>;
}
