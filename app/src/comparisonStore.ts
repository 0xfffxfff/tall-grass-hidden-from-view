// localStorage persistence for FHE comparison results.
// Keys are canonical "{a}:{b}:{trait}" with a < b always.

const STORAGE_KEY = "tallgrass:comparisons";

type Result = ">" | "<" | "=";
interface StoreEntry {
  result: Result;
  verified: boolean;
}
type Store = Record<string, StoreEntry>;

function flip(r: Result): Result {
  if (r === ">") return "<";
  if (r === "<") return ">";
  return "=";
}

function canonKey(a: number, b: number, trait: number): { key: string; flipped: boolean } {
  if (a <= b) return { key: `${a}:${b}:${trait}`, flipped: false };
  return { key: `${b}:${a}:${trait}`, flipped: true };
}

function read(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migrate old format (string values) to new format (object with verified flag)
    const store: Store = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === "string") {
        store[key] = { result: val as Result, verified: false };
      } else {
        store[key] = val as StoreEntry;
      }
    }
    return store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function saveResult(a: number, b: number, trait: number, result: Result, verified = false): void {
  const { key, flipped } = canonKey(a, b, trait);
  const store = read();
  store[key] = { result: flipped ? flip(result) : result, verified };
  write(store);
}

export function markVerified(a: number, b: number, trait: number): void {
  const { key } = canonKey(a, b, trait);
  const store = read();
  if (store[key]) {
    store[key].verified = true;
    write(store);
  }
}

export function getResult(a: number, b: number, trait: number): Result | null {
  if (a === b) return "=";
  const { key, flipped } = canonKey(a, b, trait);
  const store = read();
  const entry = store[key];
  if (!entry) return null;
  return flipped ? flip(entry.result) : entry.result;
}

export function isVerified(a: number, b: number, trait: number): boolean {
  if (a === b) return true;
  const { key } = canonKey(a, b, trait);
  const store = read();
  return store[key]?.verified ?? false;
}

export function loadAll(): Record<string, { result: Result; verified: boolean }> {
  return read();
}

export function exportJSON(): string {
  return JSON.stringify(read(), null, 2);
}

export function countVerified(): number {
  return Object.values(read()).filter(e => e.verified).length;
}

export function countCompleted(): number {
  return Object.keys(read()).length;
}
