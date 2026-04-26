import { useEffect, useState } from "react";
import { useWorkTasks, type WorkScope } from "@/lib/workBus";

interface Props {
  scope: WorkScope;
  className?: string;
}

export function WorkStrip({ scope, className }: Props) {
  const tasks = useWorkTasks(scope);
  const active = tasks[tasks.length - 1] ?? null;

  // Tick once per second so the elapsed counter advances.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;

  const elapsed = Math.max(0, Math.floor((now - active.startedAt) / 1000));

  return (
    <div className={"work-strip" + (className ? " " + className : "")}>
      <span className="pip" />
      <span className="label">{active.label}</span>
      {elapsed > 0 && <span className="elapsed">{elapsed}s</span>}
      {tasks.length > 1 && (
        <span className="queue">
          <span className="sep">&middot;</span>+{tasks.length - 1} queued
        </span>
      )}
    </div>
  );
}
