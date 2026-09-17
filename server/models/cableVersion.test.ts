import { describe, expect, it } from 'vitest';
import { mapCableVersionRow, type CableVersionRow } from './cableVersion.js';

const author = {
  id: 'deleted-user',
  firstName: 'Original',
  lastName: 'Author',
  email: 'author@example.com',
};

const version: CableVersionRow = {
  id: 'version',
  cable_id: 'cable',
  version_number: 2,
  change_type: 'update',
  change_source: 'manual',
  cable_number: 10,
  revision: 'B',
  mto: null,
  tag: null,
  cable_type_id: 'type',
  cable_type_name: 'Cable type',
  from_location: 'A',
  to_location: 'B',
  routing: null,
  delivery: null,
  design_length: 20,
  install_length: null,
  pull_date: null,
  connected_from: null,
  connected_to: null,
  tested: null,
  created_at: '2026-09-17T00:00:00.000Z',
  changed_by: null,
  changed_by_first_name: null,
  changed_by_last_name: null,
  changed_by_email: null,
};

describe('cable version audit author', () => {
  it('preserves the author and revision when the account foreign key is cleared', () => {
    const before = mapCableVersionRow({
      ...version,
      changed_by: author.id,
      changed_by_snapshot: author,
    });
    const after = mapCableVersionRow({ ...version, changed_by_snapshot: author });

    expect(after).toEqual(before);
    expect(after.changedBy).toEqual(author);
    expect(after.revision).toBe('B');
  });

  it('keeps the author as recorded even after a profile rename', () => {
    expect(
      mapCableVersionRow({
        ...version,
        changed_by: author.id,
        changed_by_first_name: 'Renamed',
        changed_by_email: 'new@example.com',
        changed_by_snapshot: author,
      }).changedBy,
    ).toEqual(author);
  });

  it('retains email-only authors after deletion', () => {
    const emailOnly = { ...author, firstName: null, lastName: null };
    expect(
      mapCableVersionRow({
        ...version,
        changed_by_snapshot: emailOnly,
      }).changedBy,
    ).toEqual(emailOnly);
  });

  it('can still read a legacy version without an author snapshot', () => {
    expect(
      mapCableVersionRow({
        ...version,
        changed_by: author.id,
        changed_by_first_name: author.firstName,
        changed_by_last_name: author.lastName,
        changed_by_email: author.email,
      }).changedBy,
    ).toEqual(author);
  });

  it('keeps the revision even when no author information is available', () => {
    expect(mapCableVersionRow(version)).toMatchObject({ revision: 'B', changedBy: null });
  });
});
