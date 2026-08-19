const values = new Map<string, string>();
const testStorage: Storage = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key: string) {
    return values.get(String(key)) ?? null;
  },
  key(index: number) {
    return Array.from(values.keys())[index] ?? null;
  },
  removeItem(key: string) {
    values.delete(String(key));
  },
  setItem(key: string, value: string) {
    values.set(String(key), String(value));
  }
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testStorage
});
