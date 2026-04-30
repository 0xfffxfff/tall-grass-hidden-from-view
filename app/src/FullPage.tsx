import { useEffect } from "react";
import { Stage } from "@/components/monolith/Stage";

// Full-viewport monolith shader. This is what runs on the Monolith — two
// 9:16 portrait screens back-to-back. The field's kinetic events are
// derived from ciphertext bytes, pair commitments, and move slots, then
// advanced from a wall-time-anchored clock so the two screens stay in
// lockstep without any network coordination. Zoom 1.4 sits a hair below
// the v24 1.55 default — keeps the slabs framed without compressing the
// field as tightly at the edges.
//
// With entityId set (e.g. /full?id=5), Stage drops into single-entity
// locked mode: only that entity's slab renders, camera-followed so it
// stays centered while the haze drifts past. This is the per-entity
// NFT depiction — same shader code path, same atmospheric finish; what
// changes is that the field is reduced to one signature.
interface FullPageProps {
  entityId?: number;
  zoom?: number;
  // ?mirror=1: scaleX(-1) on the canvas for the second of two back-to-back
  // gallery screens, so world directions read consistently as you walk
  // around the sculpture. offsetX/offsetY are CSS pixels of camera shift,
  // converted to world units in Stage using the current dpr/zoom.
  mirror?: boolean;
  offsetX?: number;
  offsetY?: number;
}

export function FullPage({
  entityId,
  zoom = 1.4,
  mirror = false,
  offsetX = 0,
  offsetY = 0,
}: FullPageProps) {
  useEffect(() => {
    document.body.classList.add("full-mode");
    if (mirror) document.body.classList.add("mirror-mode");
    return () => {
      document.body.classList.remove("full-mode");
      document.body.classList.remove("mirror-mode");
    };
  }, [mirror]);

  return (
    <Stage
      className="stage-full"
      zoom={zoom}
      entityId={entityId}
      offsetX={offsetX}
      offsetY={offsetY}
    />
  );
}
