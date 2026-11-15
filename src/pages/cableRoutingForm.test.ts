import { describe, expect, it } from 'vitest';
import {
  buildCableInput,
  changeCableFormField,
  emptyCableForm,
  toCableFormState,
} from './ProjectDetails.forms';
import type { Cable } from '@/api/client';
import { emptyRoutingControl } from '../../shared/cableRoutingControl';

const base = { ...emptyCableForm, cableId: '1', tag: 'C-1', cableTypeId: 'type-1' };
describe('routing and execution edit form', () => {
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
  it('edits only the manual value and retains revision fences without copying the automatic display value', () => {
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
    expect(form.routing).toBe('');
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
  it('accepts valid leap day and empty execution fields and rejects negative installed length', () => {
    expect(
      buildCableInput({ ...base, tested: '2028-02-29', pullDate: '', installLength: '0' }).input,
    ).toMatchObject({ tested: '2028-02-29', pullDate: null, installLength: 0 });
    expect(buildCableInput({ ...base, installLength: '-1' }).errors.installLength).toBeTruthy();
  });
});
