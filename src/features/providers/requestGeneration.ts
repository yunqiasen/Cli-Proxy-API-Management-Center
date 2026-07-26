export interface RequestGeneration {
  begin: () => number;
  invalidate: () => number;
  isCurrent: (token: number) => boolean;
}

export function createRequestGeneration(): RequestGeneration {
  let current = 0;
  return {
    begin: () => current,
    invalidate: () => {
      current += 1;
      return current;
    },
    isCurrent: (token) => token === current,
  };
}

export interface ResourceLeaseRegistry {
  acquire: (resourceId: string) => symbol;
  release: (resourceId: string, lease: symbol) => boolean;
  has: (resourceId: string) => boolean;
  clear: () => void;
  size: () => number;
}

export function createResourceLeaseRegistry(): ResourceLeaseRegistry {
  const leases = new Map<string, symbol>();
  return {
    acquire: (resourceId) => {
      const lease = Symbol(resourceId);
      leases.set(resourceId, lease);
      return lease;
    },
    release: (resourceId, lease) => {
      if (leases.get(resourceId) !== lease) return false;
      leases.delete(resourceId);
      return true;
    },
    has: (resourceId) => leases.has(resourceId),
    clear: () => leases.clear(),
    size: () => leases.size,
  };
}
