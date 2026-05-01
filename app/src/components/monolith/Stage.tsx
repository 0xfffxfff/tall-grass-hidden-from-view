import { useEffect, useRef, type ReactNode } from "react";
import { CHAIN_SWEEP_SLOTS, reactiveState } from "./reactiveQueue";

const VS_SRC = `
attribute vec2 p;
varying vec2 vUv;
void main() {
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

// Pass 1. Y-biased for 9:16. uZoom: 1.0 desktop, 1.55 portrait. Ported
// from monolith-previews/noise-preview-v24.html.
const FS_NOISE_SRC = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uRot;
uniform float uZoom;
// uEntityLock: -1.0 = Monolith mode (all 64 slabs + comparison + sweep).
// 0.0..31.0 = single-entity locked mode: render only this entity, with
// the camera following its position so the slab stays centered and the
// haze drifts past. The entity loops its kinematic signature on a
// per-entity period derived from cipher byte 14.
uniform float uEntityLock;
// Static world-space camera shift (world units). Used by the back-to-back
// gallery setup so the second screen can show a different region of the
// same field. Applied to worldUv after the locked-mode camera follow, so
// haze, sweep, encounters, and comparisons all shift coherently. The
// vignette/column passes use vUv (screen space) and stay centred.
uniform vec2 uOffset;

// Chain overlay state from reactiveQueue.ts. Birth times: -1 = empty,
// >= 0 = shader-time of event.
uniform float uMintedAt[32];
uniform float uEntityPulse[32];
// (birthTime, axis 0/1, dir -1/+1)
uniform vec3 uChainSweep[8];
// (birthTime, a, b, trait*2 + greaterIsB)
uniform vec4 uChainPair;

float ciphByte(float entityId, float idx) {
  return fract(sin(dot(vec2(entityId * 7.131 + idx, 13.0),
                       vec2(127.1, 311.7))) * 43758.5453);
}
float pairByte(float entityA, float entityB, float traitId, float idx) {
  float seed = entityA * 113.0 + entityB * 271.0 + traitId * 29.0;
  return fract(sin(dot(vec2(seed + idx, 53.0),
                       vec2(127.1, 311.7))) * 43758.5453);
}
float moveByte(float moveSlot, float idx) {
  return fract(sin(dot(vec2(moveSlot * 191.0 + idx, 7.0),
                       vec2(127.1, 311.7))) * 43758.5453);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0));
  float n100 = dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0));
  float n010 = dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0));
  float n110 = dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0));
  float n001 = dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1));
  float n101 = dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1));
  float n011 = dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1));
  float n111 = dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float snapColByte(float b) {
  return (floor(b * 9.0) - 4.0) * 0.32;
}
float snapRowByte(float b) {
  return (floor(b * 5.0) - 2.0) * 0.22;
}
vec2 stdSizeByte(float b) {
  float k = floor(b * 4.0);
  if (k < 0.5)      return vec2(0.10, 0.22);
  else if (k < 1.5) return vec2(0.14, 0.28);
  else if (k < 2.5) return vec2(0.20, 0.14);
  else              return vec2(0.16, 0.16);
}

float progressCurve(float fr, float pattern) {
  if (pattern < 0.5) {
    return smoothstep(0.0, 1.0, fr);
  } else if (pattern < 1.5) {
    if (fr < 0.40)      return mix(0.0, 0.50, smoothstep(0.0, 0.40, fr));
    else if (fr < 0.55) return 0.50;
    else                return mix(0.50, 1.0, smoothstep(0.55, 1.0, fr));
  } else if (pattern < 2.5) {
    if (fr < 0.30)      return mix(0.0, 0.65, smoothstep(0.0, 0.30, fr));
    else if (fr < 0.42) return 0.65;
    else if (fr < 0.62) return mix(0.65, 0.30, smoothstep(0.42, 0.62, fr));
    else if (fr < 0.74) return 0.30;
    else                return mix(0.30, 1.0, smoothstep(0.74, 1.0, fr));
  } else if (pattern < 3.5) {
    if (fr < 0.42)      return mix(0.0, 0.70, smoothstep(0.0, 0.42, fr));
    else if (fr < 0.58) return 0.70;
    else                return mix(0.70, 0.0, smoothstep(0.58, 1.0, fr));
  } else if (pattern < 4.5) {
    if (fr < 0.40)      return 0.50;
    else                return mix(0.50, 1.0, smoothstep(0.40, 1.0, fr));
  } else {
    if (fr < 0.55)      return mix(0.0, 0.50, smoothstep(0.0, 0.55, fr));
    else                return 0.50;
  }
}

float encounter(vec2 uv, float i, float t) {
  float period = 14.0 + 7.0 * hash21(vec2(i, 1.7));
  float phase  = (t + i * 4.6) / period;
  float slot   = floor(phase);
  float fr     = fract(phase);

  float entityId = floor(hash21(vec2(slot, i * 89.0)) * 32.0);

  // Skip loop instances of the locked entity; it has its own perpetual
  // overlay at screen centre.
  if (uEntityLock >= 0.0 && abs(entityId - uEntityLock) < 0.5) {
    return 0.0;
  }

  float axisRaw = ciphByte(entityId, 0.0);
  float axis = (axisRaw < 0.20) ? 0.0
             : (axisRaw < 0.80) ? 1.0
             :                    2.0;
  float gx = snapColByte(ciphByte(entityId, 1.0));
  float gy = snapRowByte(ciphByte(entityId, 2.0));

  float jit = 0.05;
  gx += (ciphByte(entityId, 10.0) - 0.5) * jit;
  gy += (ciphByte(entityId, 11.0) - 0.5) * jit;

  vec2 size = stdSizeByte(ciphByte(entityId, 3.0));
  float dir = (ciphByte(entityId, 4.0) < 0.5) ? -1.0 : 1.0;
  float pattern = floor(ciphByte(entityId, 5.0) * 6.0);

  float appearStart = ciphByte(entityId, 6.0) * 0.18;
  float appearEnd   = appearStart + 0.06
                    + ciphByte(entityId, 7.0) * 0.10;
  float sinkStart   = mix(appearEnd + 0.20, 0.85,
                          ciphByte(entityId, 8.0));
  float sinkEnd     = sinkStart + 0.05
                    + ciphByte(entityId, 9.0) * 0.10;
  float visibility  = smoothstep(appearStart, appearEnd, fr)
                    * (1.0 - smoothstep(sinkStart, sinkEnd, fr));

  vec2 pos = vec2(gx, gy);
  float u = progressCurve(fr, pattern);
  if (axis < 0.5) {
    pos.x = mix(-1.55 * dir, 1.55 * dir, u);
  } else if (axis < 1.5) {
    pos.y = mix(-1.10 * dir, 1.10 * dir, u);
  }

  float depth;
  if (axis < 1.5) {
    depth = mix(0.55, 0.05, visibility);
  } else {
    float winLen = max(sinkEnd - appearStart, 1e-4);
    float activeFr = clamp((fr - appearStart) / winLen, 0.0, 1.0);
    float bellZ = 4.0 * activeFr * (1.0 - activeFr);
    depth = pow(1.0 - bellZ, 1.4);
  }

  float ang = (ciphByte(entityId, 12.0) - 0.5) * 6.2832 * uRot;
  float c = cos(ang);
  float s = sin(ang);
  vec2 q = uv - pos;
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float d = sdBox(q, size);
  float edge = 0.012 + depth * 0.45;
  float mask = 1.0 - smoothstep(-edge, edge, d);

  float alpha = visibility;
  if (axis >= 1.5) {
    float winLen = max(sinkEnd - appearStart, 1e-4);
    float activeFr = clamp((fr - appearStart) / winLen, 0.0, 1.0);
    alpha *= pow(4.0 * activeFr * (1.0 - activeFr), 0.6) + 0.10;
  }

  return mask * alpha;
}

// Persistent mint slab. Same shape as encounter() but visibility held
// high across the loop. mintedTime fades in; pulseTime breathes on
// EntityMoved.
float chainEntity(vec2 uv, float entityId, float t, float mintedTime, float pulseTime) {
  // 0.24 shader-sec = 4 wall-sec at SPEED=0.06. Boot-replayed mints pass
  // far-past mintedTime so fadeIn is already 1.0.
  float fadeIn = smoothstep(0.0, 0.24, t - mintedTime);
  // Per-entity period from cipher byte 14, same as locked-mode camera.
  float period = 14.0 + 7.0 * ciphByte(entityId, 14.0);
  float fr = fract(t / period);

  float axisRaw = ciphByte(entityId, 0.0);
  float axis = (axisRaw < 0.20) ? 0.0
             : (axisRaw < 0.80) ? 1.0
             :                    2.0;
  float gx = snapColByte(ciphByte(entityId, 1.0));
  float gy = snapRowByte(ciphByte(entityId, 2.0));
  gx += (ciphByte(entityId, 10.0) - 0.5) * 0.05;
  gy += (ciphByte(entityId, 11.0) - 0.5) * 0.05;

  vec2 size = stdSizeByte(ciphByte(entityId, 3.0));
  float dir = (ciphByte(entityId, 4.0) < 0.5) ? -1.0 : 1.0;
  float pattern = floor(ciphByte(entityId, 5.0) * 6.0);

  vec2 pos = vec2(gx, gy);
  float u = progressCurve(fr, pattern);
  if (axis < 0.5) {
    pos.x = mix(-1.55 * dir, 1.55 * dir, u);
  } else if (axis < 1.5) {
    pos.y = mix(-1.10 * dir, 1.10 * dir, u);
  }

  // Pulse: asymmetric "breath" on alpha after EntityMoved. Easing-out
  // rise to peak in 2 wall-seconds, then a long, very gentle decay over
  // 11 wall-seconds back to baseline. Durations in shader-time:
  // 0.12 == 2 wall-sec, 0.78 == 13 wall-sec, both at SPEED=0.06.
  float pulseAge = t - pulseTime;
  float pulse;
  if (pulseTime < 0.0 || pulseAge < 0.0 || pulseAge > 0.78) {
    pulse = 0.0;
  } else if (pulseAge < 0.12) {
    pulse = smoothstep(0.0, 0.12, pulseAge);
  } else {
    // Fall: ~5.5x slower than rise.
    pulse = 1.0 - smoothstep(0.12, 0.78, pulseAge);
  }

  float ang = (ciphByte(entityId, 12.0) - 0.5) * 6.2832 * uRot;
  float c = cos(ang);
  float s = sin(ang);
  vec2 q = uv - pos;
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float d = sdBox(q, size);

  // Pulse breathes alpha only; edge and size fixed.
  float depth = 0.30;
  float edge = 0.012 + depth * 0.45;
  float mask = 1.0 - smoothstep(-edge, edge, d);

  // Alpha intentionally >1 at peak; downstream ink curve saturates to
  // black. fadeIn gates the post-mint ramp.
  float alpha = (0.85 + pulse * 1.50) * fadeIn;
  return mask * alpha;
}

// Extra sweep from a real Moved event. Same shape as moveSweep() but
// driven by an explicit birth time instead of t/period, and runs on a
// wall-clock-friendly duration so it reads as a discrete event. 0.24
// shader-seconds == 4 wall-clock seconds at SPEED=0.06.
float chainSweepLine(vec2 uv, float t, float birthTime, float axis, float dir) {
  float age = t - birthTime;
  if (age < 0.0 || age > 0.24) return 0.0;
  float fr = age / 0.24;
  float pos = mix(-1.6 * dir, 1.6 * dir, fr);
  float d;
  if (axis > 0.5) {
    float posY = mix(-0.8 * dir, 0.8 * dir, fr);
    d = abs(uv.y - posY);
  } else {
    d = abs(uv.x - pos);
  }
  // 6.0 vs moveSweep's 9.0: wider band so chain reads distinct.
  float line = exp(-pow(d * 6.0, 2.0));
  float decay = 4.0 * fr * (1.0 - fr);
  return line * decay;
}

// Oracle compare: winner on tighter window, loser starts and ends a beat
// later. 2.06 shader-sec = ~34 wall-sec at SPEED=0.06.
float chainComparisonPair(vec2 uv, float t, vec4 pair) {
  float birthTime = pair.x;
  float age = t - birthTime;
  if (age < 0.0 || age > 2.06) return 0.0;
  float fr = age / 2.06;

  float entityA = pair.y;
  float entityB = pair.z;
  // Recover trait + winner from the packed channel.
  float pw = pair.w;
  float greaterIsB = mod(pw, 2.0);
  float traitId = floor(pw / 2.0);

  float axisX = step(0.70, pairByte(entityA, entityB, traitId, 0.0));
  float lane = (axisX > 0.5)
             ? snapRowByte(pairByte(entityA, entityB, traitId, 1.0))
             : snapColByte(pairByte(entityA, entityB, traitId, 1.0));

  float patternRaw = floor(pairByte(entityA, entityB, traitId, 2.0) * 4.0);
  float pattern = patternRaw < 0.5 ? 0.0
                : patternRaw < 1.5 ? 1.0
                : patternRaw < 2.5 ? 4.0
                : 5.0;

  // Winner: 0.00..0.65. Loser: 0.15..1.00. They overtake mid-window.
  float frWin  = clamp((fr - 0.00) / 0.65, 0.0, 1.0);
  float frLose = clamp((fr - 0.15) / 0.85, 0.0, 1.0);
  float frA = (greaterIsB < 0.5) ? frWin : frLose;
  float frB = (greaterIsB > 0.5) ? frWin : frLose;

  float uA = progressCurve(frA, pattern);
  float uB = progressCurve(frB, pattern);
  float slideA = mix(-1.40, 1.40, uA);
  float slideB = mix(-1.40, 1.40, uB);

  // Perpendicular offset so slabs don't collide on overtake.
  float laneOffset = 0.18;
  vec2 posA, posB;
  if (axisX > 0.5) {
    posA = vec2(slideA, lane - laneOffset);
    posB = vec2(slideB, lane + laneOffset);
  } else {
    posA = vec2(lane - laneOffset, slideA);
    posB = vec2(lane + laneOffset, slideB);
  }

  vec2 sizeA = stdSizeByte(ciphByte(entityA, 3.0));
  vec2 sizeB = stdSizeByte(ciphByte(entityB, 3.0));
  float kGreater = 1.25;
  float kLesser  = 0.85;
  sizeA *= (greaterIsB < 0.5 ? kGreater : kLesser);
  sizeB *= (greaterIsB > 0.5 ? kGreater : kLesser);

  float bellA  = 4.0 * frA * (1.0 - frA);
  float bellB  = 4.0 * frB * (1.0 - frB);
  float depthA = mix(0.55, 0.05, bellA);
  float depthB = mix(0.55, 0.05, bellB);
  float edgeA  = 0.012 + depthA * 0.45;
  float edgeB  = 0.012 + depthB * 0.45;
  float fadeA  = smoothstep(0.0, 0.10, frA) * (1.0 - smoothstep(0.90, 1.0, frA));
  float fadeB  = smoothstep(0.0, 0.10, frB) * (1.0 - smoothstep(0.90, 1.0, frB));

  float ang = (pairByte(entityA, entityB, traitId, 3.0) - 0.5) * 6.2832 * uRot;
  float cR = cos(ang);
  float sR = sin(ang);
  vec2 qA = uv - posA;
  qA = vec2(cR * qA.x - sR * qA.y, sR * qA.x + cR * qA.y);
  vec2 qB = uv - posB;
  qB = vec2(cR * qB.x - sR * qB.y, sR * qB.x + cR * qB.y);
  float maskA = 1.0 - smoothstep(-edgeA, edgeA, sdBox(qA, sizeA));
  float maskB = 1.0 - smoothstep(-edgeB, edgeB, sdBox(qB, sizeB));

  float alphaA = fadeA * (greaterIsB < 0.5 ? 1.10 : 0.92);
  float alphaB = fadeB * (greaterIsB > 0.5 ? 1.10 : 0.92);
  return maskA * alphaA + maskB * alphaB;
}

float moveSweep(vec2 uv, float t) {
  float period = 7.0;
  float idx = floor(t / period);
  float age = mod(t, period);
  float fr  = age / period;

  float axisX = step(0.70, moveByte(idx, 0.0));
  float dirSign = (moveByte(idx, 1.0) < 0.5) ? -1.0 : 1.0;
  float pos = mix(-1.6 * dirSign, 1.6 * dirSign, fr);

  float d;
  if (axisX > 0.5) {
    d = abs(uv.x - pos);
  } else {
    float posY = mix(-0.8 * dirSign, 0.8 * dirSign, fr);
    d = abs(uv.y - posY);
  }

  float line = exp(-pow(d * 9.0, 2.0));
  float decay = 4.0 * fr * (1.0 - fr);
  return line * decay;
}

void main() {
  vec2 uv = (vUv - 0.5) * (uRes / 520.0) / max(uZoom, 0.01);
  float t = uTime;

  // Locked mode: world shifted so the entity sits at screen center.
  // Locked slab drawn on top of the field.
  bool isLocked = (uEntityLock >= 0.0);
  vec2 cameraPos = vec2(0.0);
  vec2 lockedSize = vec2(0.0);

  if (isLocked) {
    // Same derivation as encounter(); period from cipher byte 14.
    float entityId = uEntityLock;
    float period = 14.0 + 7.0 * ciphByte(entityId, 14.0);
    float fr = fract(t / period);

    float axisRaw = ciphByte(entityId, 0.0);
    float axis = (axisRaw < 0.20) ? 0.0
               : (axisRaw < 0.80) ? 1.0
               :                    2.0;
    float gx = snapColByte(ciphByte(entityId, 1.0));
    float gy = snapRowByte(ciphByte(entityId, 2.0));
    float jit = 0.05;
    gx += (ciphByte(entityId, 10.0) - 0.5) * jit;
    gy += (ciphByte(entityId, 11.0) - 0.5) * jit;
    lockedSize = stdSizeByte(ciphByte(entityId, 3.0));
    float dir = (ciphByte(entityId, 4.0) < 0.5) ? -1.0 : 1.0;
    float pattern = floor(ciphByte(entityId, 5.0) * 6.0);

    cameraPos = vec2(gx, gy);
    float u = progressCurve(fr, pattern);
    if (axis < 0.5) {
      cameraPos.x = mix(-1.55 * dir, 1.55 * dir, u);
    } else if (axis < 1.5) {
      cameraPos.y = mix(-1.10 * dir, 1.10 * dir, u);
    }
    // Z-axis entities don't translate; cameraPos stays at (gx, gy).
  }

  // worldUv = uv in Monolith mode; in locked mode the entity lands at
  // screen center.
  vec2 worldUv = uv + cameraPos + uOffset;

  float ink = 0.0;
  for (int i = 0; i < 64; i++) {
    ink += encounter(worldUv, float(i), t);
  }

  // Chain overlay: mint slabs additive on the encounter field; chain
  // pair is the only comparison.
  for (int eid = 0; eid < 32; eid++) {
    if (uMintedAt[eid] < 0.0) continue;
    ink += chainEntity(worldUv, float(eid), t, uMintedAt[eid], uEntityPulse[eid]);
  }
  if (uChainPair.x >= 0.0) {
    ink += chainComparisonPair(worldUv, t, uChainPair);
  }

  // Drawn on top so the locked entity stays identifiable when slabs
  // cross at the same depth.
  if (isLocked) {
    float d = sdBox(uv, lockedSize);
    float edge = 0.012 + 0.05 * 0.45;
    ink += 1.0 - smoothstep(-edge, edge, d);
  }

  // Haze drifts with the camera so motion of the locked entity reads
  // as the world flowing past.
  float haze = fbm(vec3(worldUv * 0.7, t * 0.025));
  haze = 0.5 + 0.5 * haze;
  // Gradient on screen-y, not world-y.
  haze = mix(haze, haze * 0.85 + 0.15, smoothstep(-0.3, 0.4, uv.y));
  haze += moveSweep(worldUv, t) * 0.07;

  // Weight 0.25 vs synthetic 0.07: chain sweep reads as discrete.
  for (int s = 0; s < 8; s++) {
    vec3 sw = uChainSweep[s];
    if (sw.x < 0.0) continue;
    haze += chainSweepLine(worldUv, t, sw.x, sw.y, sw.z) * 0.25;
  }

  ink = 1.0 - exp(-ink * 1.4);
  float density = ink * 0.95 + haze * 0.06;
  density = clamp(density, 0.0, 1.0);
  gl_FragColor = vec4(density, density, density, 1.0);
}
`;

const FS_BLUR_SRC = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uTime;
uniform float uAspect;

float sample13(vec2 uv, vec2 dir) {
  float sum = 0.0;
  sum += texture2D(uTex, uv + dir * -6.0).r * 0.002216;
  sum += texture2D(uTex, uv + dir * -5.0).r * 0.008764;
  sum += texture2D(uTex, uv + dir * -4.0).r * 0.026995;
  sum += texture2D(uTex, uv + dir * -3.0).r * 0.064759;
  sum += texture2D(uTex, uv + dir * -2.0).r * 0.120985;
  sum += texture2D(uTex, uv + dir * -1.0).r * 0.176033;
  sum += texture2D(uTex, uv              ).r * 0.199471;
  sum += texture2D(uTex, uv + dir *  1.0).r * 0.176033;
  sum += texture2D(uTex, uv + dir *  2.0).r * 0.120985;
  sum += texture2D(uTex, uv + dir *  3.0).r * 0.064759;
  sum += texture2D(uTex, uv + dir *  4.0).r * 0.026995;
  sum += texture2D(uTex, uv + dir *  5.0).r * 0.008764;
  sum += texture2D(uTex, uv + dir * -6.0).r * 0.002216;
  return sum;
}

void main() {
  vec2 stepH = vec2(uTexel.x * 6.0, 0.0);
  vec2 stepV = vec2(0.0, uTexel.y * 6.0);

  float a = sample13(vUv, stepH);
  float b = sample13(vUv, stepV);
  float m = (a + b) * 0.5;

  vec2 d1 = stepH * 0.7 + stepV * 0.7;
  vec2 d2 = stepH * 0.7 - stepV * 0.7;
  float extra =
      texture2D(uTex, vUv + d1).r
    + texture2D(uTex, vUv - d1).r
    + texture2D(uTex, vUv + d2).r
    + texture2D(uTex, vUv - d2).r;
  m = mix(m, extra * 0.25, 0.30);

  float ink = clamp(m, 0.0, 1.0);
  float lum = 1.0 - ink;
  lum = pow(lum, 0.78);
  float darkness = 1.0 - lum;

  vec3 white = vec3(1.85, 1.84, 1.78);
  vec3 black = vec3(0.05, 0.05, 0.07);
  vec3 col = mix(white, black, darkness);

  float halo = smoothstep(0.85, 1.0, lum);
  col += vec3(0.30, 0.30, 0.32) * halo;

  float column = exp(-pow((vUv.x - 0.5) * 3.5, 2.0));
  col += vec3(0.05) * column * (0.4 + 0.4 * sin(uTime * 0.07));

  vec2 vu = vUv - 0.5;
  vu.x *= uAspect;
  float vig = smoothstep(1.10, 0.30, length(vu));
  col *= mix(0.86, 1.0, vig);

  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime * 0.7) * 43758.5453);
  col += (grain - 0.5) * 0.012;

  gl_FragColor = vec4(col, 1.0);
}
`;

// Time advance rate. 0.06x is the v24 default — slow enough that each
// slab registers before the next, matching the silent-volume aesthetic.
const SPEED = 0.06;

// Daily 06:00 UTC re-anchor. Seeds effectiveTime from wall time so two
// screens loaded at the same instant compute the same value (lockstep),
// and rebases once per day to bound Float32 magnitude. 06:00 UTC is
// off-hours in every gallery timezone we'd plausibly play in.
const SYNC_PERIOD_MS = 86400000;
const ANCHOR_OFFSET_MS = 6 * 3600000;

function syncInitial(): number {
  return (((Date.now() - ANCHOR_OFFSET_MS) % SYNC_PERIOD_MS) / 1000) * SPEED;
}
function syncBucket(): number {
  return Math.floor((Date.now() - ANCHOR_OFFSET_MS) / SYNC_PERIOD_MS);
}

interface StageProps {
  children?: ReactNode;
  className?: string;
  // World-space zoom. 1.0 fits a desktop landscape viewport; 1.55 fits
  // the 9:16 portrait monolith without empty top/bottom bands. See the
  // notes in monolith-previews/noise-preview-v24.html for other aspects.
  zoom?: number;
  // When set to an integer 0..31, locks the view to that entity. Renders
  // only that entity's slab (no other encounters, no comparison, no
  // sweep), with the camera following it so the slab stays centered and
  // the haze drifts past. Used for the per-entity NFT depiction.
  // Undefined or out of range → Monolith mode.
  entityId?: number;
  // CSS-pixel camera shift for back-to-back gallery screens. Converted to
  // world units at draw time using current dpr/zoom: 1080 CSS px on a
  // dpr=1, zoom=1.4 screen ≈ exactly one screen-width of shift.
  offsetX?: number;
  offsetY?: number;
}

export function Stage({
  children,
  className,
  zoom = 1.0,
  entityId,
  offsetX = 0,
  offsetY = 0,
}: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // -1 sentinel for "no lock"; otherwise the entity ID. Refs so prop
  // changes propagate without re-running the effect (which rebuilds
  // the GL context).
  const entityLockRef = useRef<number>(
    entityId !== undefined && entityId >= 0 && entityId <= 31 ? entityId : -1
  );
  entityLockRef.current =
    entityId !== undefined && entityId >= 0 && entityId <= 31 ? entityId : -1;
  const offsetXRef = useRef(offsetX);
  offsetXRef.current = offsetX;
  const offsetYRef = useRef(offsetY);
  offsetYRef.current = offsetY;

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const gl = canvas.getContext("webgl", {
      antialias: false,
      preserveDrawingBuffer: false,
      colorSpace: "display-p3",
    } as WebGLContextAttributes);
    if (!gl) {
      stage.innerHTML =
        '<div style="color:#666;font-family:Helvetica,Arial,sans-serif;padding:2em;text-align:center;">webgl unavailable</div>';
      return;
    }
    if ("drawingBufferColorSpace" in gl) {
      try {
        (gl as unknown as { drawingBufferColorSpace: string }).drawingBufferColorSpace = "display-p3";
      } catch {
        // Older browsers; fall back to default sRGB.
      }
    }

    function compile(type: number, src: string): WebGLShader {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error(gl!.getShaderInfoLog(s));
      }
      return s;
    }
    function program(vs: string, fs: string): WebGLProgram {
      const p = gl!.createProgram()!;
      gl!.attachShader(p, compile(gl!.VERTEX_SHADER, vs));
      gl!.attachShader(p, compile(gl!.FRAGMENT_SHADER, fs));
      gl!.linkProgram(p);
      if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
        console.error(gl!.getProgramInfoLog(p));
      }
      return p;
    }

    const progNoise = program(VS_SRC, FS_NOISE_SRC);
    const progBlur = program(VS_SRC, FS_BLUR_SRC);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    function bindAttr(prog: WebGLProgram) {
      const loc = gl!.getAttribLocation(prog, "p");
      gl!.enableVertexAttribArray(loc);
      gl!.vertexAttribPointer(loc, 2, gl!.FLOAT, false, 0, 0);
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();

    let texW = 0,
      texH = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = stage!.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width * dpr));
      const h = Math.max(1, Math.floor(r.height * dpr));
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
      }
      const tw = Math.max(64, Math.floor(w / 3));
      const th = Math.max(64, Math.floor(h / 3));
      if (tw !== texW || th !== texH) {
        texW = tw;
        texH = th;
        gl!.bindTexture(gl!.TEXTURE_2D, tex);
        gl!.texImage2D(
          gl!.TEXTURE_2D,
          0,
          gl!.RGBA,
          tw,
          th,
          0,
          gl!.RGBA,
          gl!.UNSIGNED_BYTE,
          null
        );
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
        gl!.framebufferTexture2D(
          gl!.FRAMEBUFFER,
          gl!.COLOR_ATTACHMENT0,
          gl!.TEXTURE_2D,
          tex,
          0
        );
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      }
    }
    window.addEventListener("resize", resize);
    resize();

    const onContextLost = (e: Event) => e.preventDefault();
    canvas.addEventListener("webglcontextlost", onContextLost);

    let effectiveTime = syncInitial();
    let lastWall = performance.now();
    let lastSyncBucket = syncBucket();
    let rafId = 0;
    let running = false;

    // Cache uniform locations once per program — getUniformLocation per
    // frame for 32-entry arrays would be wasteful at 60fps.
    const locMintedAt = gl!.getUniformLocation(progNoise, "uMintedAt[0]");
    const locEntityPulse = gl!.getUniformLocation(progNoise, "uEntityPulse[0]");
    const locChainSweep = gl!.getUniformLocation(progNoise, "uChainSweep[0]");
    const locChainPair = gl!.getUniformLocation(progNoise, "uChainPair");
    // Flat vec3 buffer reused each frame.
    const sweepBuffer = new Float32Array(CHAIN_SWEEP_SLOTS * 3);

    function draw() {
      if (gl!.isContextLost()) return;
      resize();

      const wall = performance.now();
      const dt = Math.min(0.1, (wall - lastWall) / 1000);
      lastWall = wall;
      effectiveTime += dt * SPEED;

      const currentBucket = syncBucket();
      if (currentBucket !== lastSyncBucket) {
        effectiveTime = syncInitial();
        lastSyncBucket = currentBucket;
      }
      const t = effectiveTime;
      // Publish shader-time so FullPage can stamp incoming chain events
      // with a birthTime in the same frame the shader is rendering at.
      reactiveState.shaderTime = t;

      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, null);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.viewport(0, 0, texW, texH);
      gl!.useProgram(progNoise);
      bindAttr(progNoise);
      gl!.uniform2f(gl!.getUniformLocation(progNoise, "uRes"), texW, texH);
      gl!.uniform1f(gl!.getUniformLocation(progNoise, "uTime"), t);
      gl!.uniform1f(gl!.getUniformLocation(progNoise, "uRot"), 0.0);
      gl!.uniform1f(gl!.getUniformLocation(progNoise, "uZoom"), zoomRef.current);
      gl!.uniform1f(gl!.getUniformLocation(progNoise, "uEntityLock"), entityLockRef.current);
      // CSS px → world units. From `uv = (vUv - 0.5) * uRes / 520 / zoom`
      // and texW = canvas.width / 3, canvas.width = cssWidth * dpr, this
      // works out to dpr / (1560 * zoom) world units per CSS pixel. At
      // dpr=1 zoom=1.4, 1080 CSS px ≈ 0.495 world units, which equals
      // exactly one viewport-width of shift on a 1080px-wide screen.
      const dprNow = Math.min(window.devicePixelRatio || 1, 2);
      const pxToWorld = dprNow / (1560 * Math.max(zoomRef.current, 0.01));
      gl!.uniform2f(
        gl!.getUniformLocation(progNoise, "uOffset"),
        offsetXRef.current * pxToWorld,
        offsetYRef.current * pxToWorld,
      );

      // Chain reactivity uniforms. Singleton defaults (mintedAt=-1,
      // pulse=-1, sweeps[*].x=-1, pair.x=-1) produce zero contribution in
      // the shader, so an empty chain (no live activity, RPC down) renders
      // identically to "synthetic only".
      gl!.uniform1fv(locMintedAt, reactiveState.mintedAt);
      gl!.uniform1fv(locEntityPulse, reactiveState.entityPulse);
      // Pack the sweep ring buffer into the flat float buffer. Empty
      // slots stay at the (-1, 0, 1) "skip" sentinel.
      for (let i = 0; i < CHAIN_SWEEP_SLOTS; i++) {
        const sw = reactiveState.sweeps[i];
        sweepBuffer[i * 3 + 0] = sw.birthTime;
        sweepBuffer[i * 3 + 1] = sw.axis;
        sweepBuffer[i * 3 + 2] = sw.dir;
      }
      gl!.uniform3fv(locChainSweep, sweepBuffer);
      const p = reactiveState.pair;
      gl!.uniform4f(
        locChainPair,
        p.birthTime,
        p.a,
        p.b,
        p.trait * 2 + p.greaterIsB,
      );

      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.useProgram(progBlur);
      bindAttr(progBlur);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.uniform1i(gl!.getUniformLocation(progBlur, "uTex"), 0);
      gl!.uniform2f(
        gl!.getUniformLocation(progBlur, "uTexel"),
        1 / texW,
        1 / texH
      );
      gl!.uniform1f(gl!.getUniformLocation(progBlur, "uTime"), t);
      gl!.uniform1f(
        gl!.getUniformLocation(progBlur, "uAspect"),
        canvas!.width / canvas!.height
      );
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }
    function frame() {
      try {
        draw();
      } catch (e) {
        console.error(e);
      }
      if (running) rafId = requestAnimationFrame(frame);
    }
    function startLoop() {
      if (running) return;
      running = true;
      // Reset wall clock so the first frame after resume produces a normal
      // dt instead of a multi-second jump (clamped, but still visible).
      lastWall = performance.now();
      rafId = requestAnimationFrame(frame);
    }
    function stopLoop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    // Pause the render loop when the stage is off-screen. This matters on
    // pages where the canvas can scroll out of the viewport; otherwise the
    // shader keeps eating GPU and scroll itself starts to lag.
    const io = new IntersectionObserver(
      (entries) => {
        const onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen) startLoop();
        else stopLoop();
      },
      { threshold: 0 },
    );
    io.observe(stage);

    const onVisible = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };
    document.addEventListener("visibilitychange", onVisible);

    startLoop();

    return () => {
      stopLoop();
      io.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div
      className={"stage" + (className ? " " + className : "")}
      ref={stageRef}
    >
      <canvas ref={canvasRef} />
      {children}
    </div>
  );
}
