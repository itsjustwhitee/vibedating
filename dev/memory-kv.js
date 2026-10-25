// In-memory stand-in for a Workers KV namespace, with expirationTtl. Used by the dev server and tests.
export function createMemoryKv({ now = () => Date.now() } = {}) {
  const entries = new Map();
  const puts = [];
  return {
    entries,
    puts,
    async get(key) {
      const e = entries.get(key);
      if (!e) return null;
      if (e.until !== undefined && e.until <= now()) {
        entries.delete(key);
        return null;
      }
      return e.value;
    },
    async put(key, value, options = {}) {
      puts.push({ key, value, options });
      entries.set(key, { value, until: options.expirationTtl ? now() + options.expirationTtl * 1000 : undefined });
    },
  };
}
