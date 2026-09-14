export const TOKEN_STORAGE_KEY = 'wfc_auth_token';

export const readStoredToken = (): string | null =>
  typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_STORAGE_KEY);
