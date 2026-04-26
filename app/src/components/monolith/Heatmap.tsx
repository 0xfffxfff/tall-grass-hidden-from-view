import { useEffect, useRef, useState } from "react";
import {
  fmtId,
  fmtTime,
  pairKey,
  pairTraitKey,
  type LitByTrait,
  type RevealsByPair,
} from "./monolithLib";

interface Props {
  trait: number;
  entityCount: number;
  reveals: RevealsByPair;
  lit: LitByTrait;
  busyKeys: Set<string>;
  flashKey: string | null;
  onCellClick: (a: number, b: number, key: string) => void;
}

export function Heatmap({
  trait,
  entityCount,
  reveals,
  lit,
  busyKeys,
  flashKey,
  onCellClick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);

  const cells: React.ReactNode[] = [];
  const litTrait = lit[trait] || new Set<string>();
  for (let i = 0; i < entityCount; i++) {
    for (let j = 0; j < entityCount; j++) {
      if (i === j) {
        cells.push(<div key={`${i}_${j}`} className="hm-cell diag" />);
        continue;
      }
      const key = pairKey(i, j);
      const busyKey = pairTraitKey(i, j, trait);
      const isLit = litTrait.has(key);
      const isBusy = busyKeys.has(busyKey);
      const isFlash = flashKey === busyKey;
      const cls =
        "hm-cell" +
        (isLit ? " lit" : "") +
        (isBusy ? " busy" : "") +
        (isFlash ? " flash" : "");
      cells.push(
        <div
          key={`${i}_${j}`}
          className={cls}
          data-key={key}
          onMouseEnter={(e) => onHover(e, i, j, key)}
          onMouseLeave={() => setTip(null)}
          onClick={() => onCellClick(Math.min(i, j), Math.max(i, j), key)}
        />
      );
    }
  }

  function onHover(
    e: React.MouseEvent<HTMLDivElement>,
    i: number,
    j: number,
    key: string
  ) {
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const rec = reveals[key]?.[trait];
    let text: string;
    if (rec) {
      const signed = rec.by && rec.by !== "anon" && rec.by.startsWith("0x");
      text =
        fmtId(a) +
        " vs " +
        fmtId(b) +
        " · trait " +
        trait +
        " · " +
        rec.op +
        " · revealed " +
        fmtTime(rec.ts) +
        (signed ? " by " + rec.by : "");
    } else {
      text =
        fmtId(a) +
        " vs " +
        fmtId(b) +
        " · trait " +
        trait +
        " · unrevealed · click to reveal";
    }
    const cellRect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return;
    setTip({
      text,
      left: cellRect.left - wrapRect.left + cellRect.width / 2,
      top: cellRect.top - wrapRect.top,
    });
  }

  useEffect(() => {
    if (!tipRef.current) return;
    if (tip) {
      tipRef.current.style.left = tip.left + "px";
      tipRef.current.style.top = tip.top + "px";
    }
  }, [tip]);

  return (
    <div className="heatmap-wrap" ref={wrapRef}>
      <div
        className="heatmap"
        role="grid"
        aria-label={`comparison heatmap, ${entityCount} entities by ${entityCount} entities, trait ${trait} selected`}
        style={{ gridTemplateColumns: `repeat(${entityCount}, 1fr)` }}
      >
        {cells}
      </div>
      <div
        ref={tipRef}
        className={"hm-tip" + (tip ? " show" : "")}
      >
        {tip?.text}
      </div>
    </div>
  );
}
