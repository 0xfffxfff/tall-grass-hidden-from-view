// Standalone, imperative port of the WebGL pipeline inside
// app/src/components/monolith/Stage.tsx (its useEffect body). This
// version is bundled into a single IIFE for the on-chain HTML viewer
// (no React, no DOM framework, no external imports). The shader
// strings are imported from ./shaders so the build script can verify
// byte-for-byte parity against Stage.tsx.
//
// Time anchoring (SYNC_PERIOD_MS / ANCHOR_OFFSET_MS / syncInitial /
// syncBucket) matches Stage exactly so two screens loaded at the same
// instant compute the same effectiveTime (lockstep), and rebases once
// per UTC day so Float32 magnitude stays bounded.

import { VS_SRC, FS_NOISE_SRC, FS_BLUR_SRC } from "./shaders";

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

export interface MountOpts {
  // When set to an integer 0..31, locks the view to that entity. Same
  // semantics as Stage's `entityId` prop. Out of range / undefined =>
  // Monolith mode.
  entityId?: number;
  // World-space zoom. 1.0 fits a desktop landscape viewport; 1.55 fits
  // the 9:16 portrait monolith. The on-chain default is 1.4 (passed
  // by the build entrypoint) — slightly punched in from desktop so the
  // single-token framing reads as a portrait of one entity, not a
  // wide field with empty margins.
  zoom?: number;
}

export function mount(canvas: HTMLCanvasElement, opts: MountOpts = {}): () => void {
  const zoom = typeof opts.zoom === "number" ? opts.zoom : 1.0;
  const entityLock =
    typeof opts.entityId === "number" && opts.entityId >= 0 && opts.entityId <= 31
      ? opts.entityId
      : -1;

  const gl = canvas.getContext("webgl", {
    antialias: false,
    preserveDrawingBuffer: false,
    colorSpace: "display-p3",
  } as WebGLContextAttributes);
  if (!gl) {
    // Match Stage's fallback: replace the canvas with a plain message.
    const msg = document.createElement("div");
    msg.style.cssText =
      "color:#666;font-family:Helvetica,Arial,sans-serif;padding:2em;text-align:center;";
    msg.textContent = "webgl unavailable";
    canvas.replaceWith(msg);
    return () => {};
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
  function program(vs: string, fs: string): { prog: WebGLProgram; vsh: WebGLShader; fsh: WebGLShader } {
    const vsh = compile(gl!.VERTEX_SHADER, vs);
    const fsh = compile(gl!.FRAGMENT_SHADER, fs);
    const p = gl!.createProgram()!;
    gl!.attachShader(p, vsh);
    gl!.attachShader(p, fsh);
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
      console.error(gl!.getProgramInfoLog(p));
    }
    return { prog: p, vsh, fsh };
  }

  const noise = program(VS_SRC, FS_NOISE_SRC);
  const blur = program(VS_SRC, FS_BLUR_SRC);
  const progNoise = noise.prog;
  const progBlur = blur.prog;

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

  let texW = 0;
  let texH = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Stage measures its wrapping div; the on-chain page is fullscreen
    // (canvas is position:fixed inset:0), so window dims are the
    // authoritative source. Same effective math.
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
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

    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, null);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.viewport(0, 0, texW, texH);
    gl!.useProgram(progNoise);
    bindAttr(progNoise);
    gl!.uniform2f(gl!.getUniformLocation(progNoise, "uRes"), texW, texH);
    gl!.uniform1f(gl!.getUniformLocation(progNoise, "uTime"), t);
    gl!.uniform1f(gl!.getUniformLocation(progNoise, "uRot"), 0.0);
    gl!.uniform1f(gl!.getUniformLocation(progNoise, "uZoom"), zoom);
    gl!.uniform1f(gl!.getUniformLocation(progNoise, "uEntityLock"), entityLock);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
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
      canvas.width / canvas.height
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

  const onVisible = () => {
    if (document.hidden) stopLoop();
    else startLoop();
  };
  document.addEventListener("visibilitychange", onVisible);

  startLoop();

  return () => {
    stopLoop();
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    document.removeEventListener("visibilitychange", onVisible);
    // Best-effort GL teardown. The on-chain viewer never tears down in
    // production — single page, single canvas — but matching Stage's
    // cleanup contract keeps mount() reusable for hot-reload during dev.
    try {
      gl!.useProgram(null);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, null);
      gl!.bindTexture(gl!.TEXTURE_2D, null);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      if (buf) gl!.deleteBuffer(buf);
      if (tex) gl!.deleteTexture(tex);
      if (fbo) gl!.deleteFramebuffer(fbo);
      gl!.deleteShader(noise.vsh);
      gl!.deleteShader(noise.fsh);
      gl!.deleteProgram(progNoise);
      gl!.deleteShader(blur.vsh);
      gl!.deleteShader(blur.fsh);
      gl!.deleteProgram(progBlur);
      const ext = gl!.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    } catch {
      // Ignore teardown errors — the page is going away.
    }
  };
}
