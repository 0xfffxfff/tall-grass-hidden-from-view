export function TraitTabs({
  count,
  selected,
  onSelect,
}: {
  count: number;
  selected: number;
  onSelect: (t: number) => void;
}) {
  const indices = Array.from({ length: count }, (_, i) => i);
  return (
    <span className="traits">
      {indices.map((i) => {
        const sel = i === selected;
        return (
          <a
            key={i}
            className={sel ? "sel" : undefined}
            onClick={() => onSelect(i)}
          >
            {`[${i}]`}
          </a>
        );
      })}
    </span>
  );
}
