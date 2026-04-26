// Singleton bus of in-flight async tasks, observed by the WorkStrip.
// The piece runs three slow systems — ZK proofs, TFHE compares, and chain
// confirmations — that visitors must see happening or assume the kiosk is
// stuck. Anything that takes >300ms goes through this bus.

import { useEffect, useReducer } from "react";

export type WorkScope = "walk" | "public";

export interface WorkTask {
  id: string;
  scope: WorkScope;
  label: string;
  startedAt: number;
}

let tasks: WorkTask[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export const workBus = {
  start(t: { id: string; scope: WorkScope; label: string }): void {
    tasks = [
      ...tasks.filter((p) => p.id !== t.id),
      { ...t, startedAt: Date.now() },
    ];
    emit();
  },
  update(id: string, label: string): void {
    let changed = false;
    tasks = tasks.map((t) => {
      if (t.id !== id) return t;
      changed = true;
      return { ...t, label };
    });
    if (changed) emit();
  },
  end(id: string): void {
    const before = tasks.length;
    tasks = tasks.filter((p) => p.id !== id);
    if (tasks.length !== before) emit();
  },
  list(): WorkTask[] {
    return tasks;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useWorkTasks(scope: WorkScope): WorkTask[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => workBus.subscribe(force), []);
  return workBus.list().filter((t) => t.scope === scope);
}
