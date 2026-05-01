// Reactive overlay state.
//
// FullPage subscribes to live chain events (Moved, Minted, EntityMoved)
// and oracle reveals (compares), and pushes them into this singleton.
// Stage reads the singleton each frame and uploads it to shader uniforms
// for an additive overlay over the synthetic field.
//
// Layout is shaped to map cleanly to GLSL uniform arrays:
//   - sweeps:       vec3[CHAIN_SWEEP_SLOTS]          (birthTime, axis 0/1, dir -1/+1)
//   - mintedAt:     float[ENTITY_COUNT]              (mint birth time, -1 = unminted)
//   - entityPulse:  float[ENTITY_COUNT]              (last EntityMoved birth time, -1 = never)
//   - pair:         vec4                             (birthTime, a, b, packed(trait*2 + greaterIsB))
//
// All birth times are in shader-time seconds (the same `t` the shader uses,
// derived from wall clock by Stage). FullPage is responsible for converting
// wall time → shader time when pushing into the queue.

export const CHAIN_SWEEP_SLOTS = 8;
export const ENTITY_COUNT = 32;

export interface ChainSweep {
  birthTime: number;
  axis: number; // 0 = X-axis sweep, 1 = Y-axis sweep
  dir: number;  // -1 or +1
}

export interface ChainPair {
  birthTime: number;
  a: number;
  b: number;
  trait: number;
  greaterIsB: number; // 0 = A bigger, 1 = B bigger
}

export interface ReactiveState {
  // Latest shader-time the GL loop saw, written by Stage each frame.
  // FullPage reads this when stamping birthTimes onto incoming events so
  // their lifecycle aligns with the same `t` the shader is rendering at.
  shaderTime: number;
  // Ring buffer of recent move sweeps. Oldest is overwritten when full.
  sweeps: ChainSweep[];
  sweepCursor: number;
  // Per-entity mint birth time (-1 = unminted) + last EntityMoved time.
  mintedAt: Float32Array;
  entityPulse: Float32Array;
  // Latest oracle compare. Older comparisons are discarded.
  pair: ChainPair;
}

function makeInitialSweeps(): ChainSweep[] {
  const out: ChainSweep[] = [];
  for (let i = 0; i < CHAIN_SWEEP_SLOTS; i++) {
    out.push({ birthTime: -1, axis: 0, dir: 1 });
  }
  return out;
}

function makeInitialPair(): ChainPair {
  return { birthTime: -1, a: 0, b: 0, trait: 0, greaterIsB: 0 };
}

export const reactiveState: ReactiveState = {
  shaderTime: 0,
  sweeps: makeInitialSweeps(),
  sweepCursor: 0,
  mintedAt: (() => {
    const a = new Float32Array(ENTITY_COUNT);
    a.fill(-1);
    return a;
  })(),
  entityPulse: (() => {
    const a = new Float32Array(ENTITY_COUNT);
    a.fill(-1);
    return a;
  })(),
  pair: makeInitialPair(),
};

export function pushSweep(birthTime: number, axis: number, dir: number): void {
  const slot = reactiveState.sweepCursor % CHAIN_SWEEP_SLOTS;
  reactiveState.sweeps[slot] = { birthTime, axis, dir };
  reactiveState.sweepCursor = (reactiveState.sweepCursor + 1) % CHAIN_SWEEP_SLOTS;
  console.log(
    `[reactive] sweep started slot=${slot} t=${birthTime.toFixed(3)} axis=${axis} dir=${dir}`,
  );
}

// `birthTime` controls the fade-in. For live mints + hotkey, pass the
// current shaderTime so the slab eases in over a few seconds. For boot
// replay, pass a far-past time (e.g. -1e6) so the slab is already at
// full visibility when the shader starts rendering.
export function markMinted(entityId: number, birthTime: number): void {
  if (entityId < 0 || entityId >= ENTITY_COUNT) return;
  if (reactiveState.mintedAt[entityId] >= 0) return;
  reactiveState.mintedAt[entityId] = birthTime;
  console.log(
    `[reactive] mint persisted entity=#${entityId} t=${birthTime.toFixed(3)}`,
  );
}

export function pulseEntity(entityId: number, birthTime: number): void {
  if (entityId < 0 || entityId >= ENTITY_COUNT) return;
  reactiveState.entityPulse[entityId] = birthTime;
  console.log(
    `[reactive] entity pulse entity=#${entityId} t=${birthTime.toFixed(3)}`,
  );
}

export function setPair(p: ChainPair): void {
  reactiveState.pair = p;
  console.log(
    `[reactive] compare pair started a=#${p.a} b=#${p.b} trait=${p.trait} greaterIsB=${p.greaterIsB} t=${p.birthTime.toFixed(3)}`,
  );
}
