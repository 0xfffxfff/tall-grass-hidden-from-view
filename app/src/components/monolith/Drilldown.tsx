import {
  pad2,
  pairKey,
  type Op,
  type RevealsByPair,
} from "./monolithLib";

interface Props {
  entityId: number;
  entityCount: number;
  traitCount: number;
  reveals: RevealsByPair;
  onSelectEntity: (id: number) => void;
  onCellClick: (a: number, b: number, trait: number) => void;
}

interface Row {
  vs: number;
  ops: (Op | null)[];
}

export function Drilldown({
  entityId,
  entityCount,
  traitCount,
  reveals,
  onSelectEntity,
  onCellClick,
}: Props) {
  const rows: Row[] = [];
  let revealCount = 0;
  let lastTs = 0;
  for (let other = 0; other < entityCount; other++) {
    if (other === entityId) continue;
    const key = pairKey(entityId, other);
    const recs = reveals[key];
    if (!recs) continue;
    const ops: (Op | null)[] = Array(traitCount).fill(null);
    let any = false;
    for (let t = 0; t < traitCount; t++) {
      const rec = recs[t];
      if (rec) {
        ops[t] = rec.op;
        revealCount++;
        any = true;
        const ms = rec.ts.getTime();
        if (ms > lastTs) lastTs = ms;
      }
    }
    if (any) rows.push({ vs: other, ops });
  }

  const lastLabel = lastTs ? formatRelative(Date.now() - lastTs) : "—";

  return (
    <section className="drill" id="drill">
      <div className="drill-head">
        entity <span className="id">#{pad2(entityId)}</span>
        <span className="sep">&middot;</span>
        <span>{revealCount} reveals</span>
        <span className="sep">&middot;</span>
        <span>{rows.length} entities compared</span>
        <span className="sep">&middot;</span>
        <span>last {lastLabel}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            {Array.from({ length: traitCount }, (_, t) => (
              <th key={t}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vs}>
              <th onClick={() => onSelectEntity(row.vs)}>vs #{pad2(row.vs)}</th>
              {row.ops.map((op, t) => {
                const cls = "cell" + (op ? " r" : "");
                return (
                  <td
                    key={t}
                    className={cls}
                    onClick={() => {
                      if (!op)
                        onCellClick(
                          Math.min(entityId, row.vs),
                          Math.max(entityId, row.vs),
                          t
                        );
                    }}
                  >
                    {op ?? "\u00B7"}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={traitCount + 1}
                style={{ color: "var(--fg-faint)", paddingTop: 8 }}
              >
                no reveals yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="foot">click any &middot; to compare</div>
    </section>
  );
}

function formatRelative(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  return h + "h ago";
}
