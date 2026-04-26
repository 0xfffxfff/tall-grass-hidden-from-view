import type { ReactNode } from "react";

export function WallAnnotation({ children }: { children: ReactNode }) {
  return (
    <section className="annot">
      <p>{children}</p>
    </section>
  );
}
