const CONFIG_RELOAD_PENDING_HEADER = 'x-config-reload-pending';

type HeaderReader = {
  get?: (name: string) => unknown;
  entries?: () => Iterable<[string, unknown]>;
  [key: string]: unknown;
};

export const configReloadPendingFromHeaders = (headers: unknown): boolean => {
  if (!headers || typeof headers !== 'object') return false;
  const source = headers as HeaderReader;
  if (typeof source.get === 'function') {
    const value = source.get('X-Config-Reload-Pending');
    if (value !== undefined && value !== null) {
      return String(value).trim().toLowerCase() === 'true';
    }
  }
  const entries =
    typeof source.entries === 'function' ? Array.from(source.entries()) : Object.entries(source);
  const match = entries.find(([key]) => key.toLowerCase() === CONFIG_RELOAD_PENDING_HEADER);
  return match ? String(match[1]).trim().toLowerCase() === 'true' : false;
};
