import { fmtId, fmtTime, type Reveal } from "./monolithLib";

interface Props {
  rows: Reveal[];
  enteringIds: Set<string>;
  onEntityClick?: (id: number) => void;
}

function rowKey(r: Reveal): string {
  return `${r.ts.getTime()}_${r.a}_${r.b}_${r.trait}`;
}

export function Stream({ rows, enteringIds, onEntityClick }: Props) {
  return (
    <>
      <div className="stream-head">
        <span>recent reveals</span>
        <span className="right">live</span>
      </div>
      <div className="stream" aria-live="polite">
        {rows.map((r) => {
          const key = rowKey(r);
          const cls = "row" + (enteringIds.has(key) ? " entering" : "");
          const signed = r.by && r.by !== "anon" && r.by.startsWith("0x");
          return (
            <div key={key} className={cls}>
              <span className="ts">{fmtTime(r.ts)}</span>
              <span className="a" onClick={() => onEntityClick?.(r.a)}>
                {fmtId(r.a)}
              </span>
              <span className="op">{r.op}</span>
              <span className="b" onClick={() => onEntityClick?.(r.b)}>
                {fmtId(r.b)}
              </span>
              <span className="tr">trait {r.trait}</span>
              <span className="by">
                {signed ? (
                  <>revealed by <span className="addr">{r.by}</span></>
                ) : null}
              </span>
              <span className="note">{r.note ?? ""}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
