import { describe, expect, it } from 'vitest';
import {
  buildCableInput,
  changeCableFormField,
  emptyCableForm,
  toCableEditFormState as toCableFormState,
} from './ProjectDetails.forms';
import type { Cable } from '@/api/client';
import { emptyRoutingControl } from '../../shared/cableRoutingControl';

const base = { ...emptyCableForm, cableId: '1', tag: 'C-1', cableTypeId: 'type-1' };
describe('routing and execution edit form', () => {
  it('keeps multiline remarks when editing an existing cable', () => {
    const remarks = 'Check installation\n[PathFinder obstacles]\nCrosses obstacle #18.\n[/PathFinder obstacles]';
    const form = toCableFormState({ cableId: 1, cableTypeId: 'type-1', tag: 'C-1', designLength: 25, routing: '/AUTO', remarks } as Cable);
    expect(form.remarks).toBe(remarks);
    expect(buildCableInput(form).input.remarks).toBe(remarks);
    expect(buildCableInput({ ...base, remarks: '' }).input.remarks).toBeNull();
  });
  it('checks manual protection on an actual route change, permits uncheck, and releases on clear', () => {
    const edited = changeCableFormField(base, 'routing', '/BC01/BC02');
    expect(edited.manualRoutingProtected).toBe('true');
    expect(buildCableInput(edited).input.manualRoutingProtected).toBe(true);
    const unchecked = changeCableFormField(edited, 'manualRoutingProtected', 'false');
    expect(buildCableInput(unchecked).input.manualRoutingProtected).toBe(false);
    expect(changeCableFormField(edited, 'routing', '').manualRoutingProtected).toBe('false');
    expect(
      changeCableFormField(unchecked, 'routing', unchecked.routing).manualRoutingProtected,
    ).toBe('false');
  });
  it('prefills the used automatic route while preserving manual intent and revision fences on unchanged save', () => {
    const cable = {
      cableId: 1,
      cableTypeId: 'type-1',
      tag: 'C-1',
      routing: '/AUTO',
      designLength: 25,
      installLength: 22,
      pullDate: '2026-11-15T00:00:00.000Z',
      routingControl: emptyRoutingControl(),
      routingControlRevision: '2',
      cableWriteRevision: '7',
      autoCalculatedRouting: '/AUTO',
    } as Cable;
    const form = toCableFormState(cable),
      result = buildCableInput(form);
    expect(form.routing).toBe('/AUTO');
    expect(form.pullDate).toBe('2026-11-15');
    expect(result.errors).toEqual({});
    expect(result.input).toMatchObject({
      routing: '',
      manualRoutingProtected: false,
      expectedCableWriteRevision: '7',
      expectedRoutingControlRevision: '2',
      installLength: 22,
      pullDate: '2026-11-15',
    });
    expect(result.input).not.toHaveProperty('autoCalculatedRouting');
  });
  it.each(['2026-02-30', '2026-13-01', '15.11.2026'])(
    'rejects invalid HTML date value %s',
    (date) => {
      expect(buildCableInput({ ...base, pullDate: date }).errors.pullDate).toBe(
        'Enter a valid date',
      );
    },
  );
  it.each([
    { manualRouting: null, manualProtected: false, executionLocked: false },
    { manualRouting: '/OLD-MANUAL', manualProtected: false, executionLocked: false },
    { manualRouting: '/USED', manualProtected: true, executionLocked: false },
    { manualRouting: '/OLD-MANUAL', manualProtected: true, executionLocked: true },
  ])('preserves unchanged routing controls: %j', (control) => {
    const form = toCableFormState({
      cableId: 1, cableTypeId: 'type-1', tag: 'C-1', designLength: 25,
      routing: '/USED', autoCalculatedRouting: '/DIFFERENT-CALCULATION',
      routingControl: { ...emptyRoutingControl(), ...control,
        executionRouting: control.executionLocked ? '/USED' : null },
    } as Cable);
    expect(form.routing).toBe('/USED');
    expect(buildCableInput(changeCableFormField(form, 'delivery', 'Updated')).input)
      .toMatchObject({ routing: control.manualRouting ?? '', manualRoutingProtected: control.manualProtected });
  });
  it('allows editing, protecting or clearing a prefilled automatic route', () => {
    const form = toCableFormState({
      cableId: 1, cableTypeId: 'type-1', tag: 'C-1', designLength: 25,
      routing: '/AUTO', routingControl: emptyRoutingControl(),
    } as Cable);
    expect(buildCableInput(changeCableFormField(form, 'routing', '/EDITED')).input)
      .toMatchObject({ routing: '/EDITED', manualRoutingProtected: true });
    expect(buildCableInput(changeCableFormField(form, 'manualRoutingProtected', 'true')).input)
      .toMatchObject({ routing: '/AUTO', manualRoutingProtected: true });
    expect(buildCableInput(changeCableFormField(form, 'routing', '')).input)
      .toMatchObject({ routing: '', manualRoutingProtected: false });
  });
  it('accepts valid leap day and empty execution fields and rejects negative installed length', () => {
    expect(
      buildCableInput({ ...base, tested: '2028-02-29', pullDate: '', installLength: '0' }).input,
    ).toMatchObject({ tested: '2028-02-29', pullDate: null, installLength: 0 });
    expect(buildCableInput({ ...base, installLength: '-1' }).errors.installLength).toBeTruthy();
  });
});
