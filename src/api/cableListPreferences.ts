import { request } from './http';

export const CABLE_LIST_COLUMNS = [
  { id: 'cableId', label: 'ID' },
  { id: 'revision', label: 'Rev.' },
  { id: 'mto', label: 'MTO' },
  { id: 'tag', label: 'Tag' },
  { id: 'typeName', label: 'Type' },
  { id: 'fromLocation', label: 'From location' },
  { id: 'toLocation', label: 'To location' },
  { id: 'routing', label: 'Routing' },
  { id: 'designLength', label: 'Design length [m]' },
  { id: 'actions', label: 'Actions' },
] as const;

export type CableListColumnId = (typeof CABLE_LIST_COLUMNS)[number]['id'];
export const DEFAULT_CABLE_LIST_COLUMNS = CABLE_LIST_COLUMNS.map(({ id }) => id);

type CableListPreferences = { columns: CableListColumnId[] };
const endpoint = '/api/users/me/cable-list-columns';

export const fetchCableListColumns = (token: string) =>
  request<CableListPreferences>(endpoint, { token });

export const updateCableListColumns = (token: string, columns: CableListColumnId[]) =>
  request<CableListPreferences>(endpoint, { method: 'PUT', token, body: { columns } });
