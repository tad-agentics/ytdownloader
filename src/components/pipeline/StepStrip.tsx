export type Phase = "input" | "searching" | "selecting" | "processing" | "stopped" | "done";

interface StepStripProps {
  phase: Phase;
}

export default function StepStrip({ phase }: StepStripProps) {
  const steps = [
    { id: "input", label: "Keywords" },
    { id: "searching", label: "Search & Pick" },
    { id: "processing", label: "Download & Upload" },
  ];
  const order: Phase[] = ["input", "searching", "selecting", "processing", "stopped", "done"];
  const cur = order.indexOf(phase);

  return (
    <div className="step-strip">
      {steps.map((s, i) => {
        const searchActive = phase === "searching" || phase === "selecting";
        const isDone =
          (s.id === "input" && cur > order.indexOf("input")) ||
          (s.id === "searching" && (cur >= order.indexOf("processing") || phase === "done")) ||
          (s.id === "processing" && phase === "done");
        const isActive =
          (s.id === "input" && phase === "input") ||
          (s.id === "searching" && searchActive) ||
          (s.id === "processing" &&
            (phase === "processing" || phase === "stopped" || phase === "done"));
        const cls = isDone ? "step done" : isActive ? "step active" : "step";
        return (
          <span key={s.id} style={{ display: "flex", alignItems: "center" }}>
            <span className={cls}>
              <span className="step-num">{isDone ? "✓" : i + 1}</span>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="step-arrow">›</span>}
          </span>
        );
      })}
    </div>
  );
}
