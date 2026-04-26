// Promise-based wrapper around the FHE web worker.

import FheWorker from "./fhe.worker.ts?worker";

type Response =
  | { type: "ready"; id: number }
  | { type: "cloudKeyLoaded"; id: number; sizeBytes: number }
  | { type: "compareResult"; id: number; entityA: number; entityB: number; traitIndex: number; gtHex: string; eqHex: string }
  | { type: "error"; id: number; message: string }
  | { type: "log"; message: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let logHandler: ((msg: string) => void) | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new FheWorker();
    worker.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      if (msg.type === "log") {
        logHandler?.(msg.message);
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === "error") {
        p.reject(new Error(msg.message));
      } else {
        p.resolve(msg);
      }
    };
  }
  return worker;
}

function send<T>(message: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...message, id });
  });
}

export function setLogHandler(fn: (msg: string) => void): void {
  logHandler = fn;
}

export const fheWorker = {
  init: () => send<void>({ type: "init" }).then(() => {}),

  loadCloudKey: () =>
    send<{ sizeBytes: number }>({ type: "loadCloudKey" }),

  compare: (entityA: number, entityB: number, traitIndex: number) =>
    send<{ entityA: number; entityB: number; traitIndex: number; gtHex: string; eqHex: string }>({
      type: "compare", entityA, entityB, traitIndex,
    }),
};
