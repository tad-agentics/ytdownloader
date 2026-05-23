export type Phase = "input" | "searching" | "results" | "processing" | "stopped" | "done";

interface StepStripProps {
  phase: Phase;
}

export default function StepStrip({ phase }: StepStripProps) {
  const steps = [
    { id: "input", label: "Keywords" },
    { id: "searching", label: "Search" },
    { id: "results", label: "Download & Upload" },
  ];
  const order: Phase[] = ["input", "searching", "results", "processing", "stopped", "done"];
  const cur = order.indexOf(phase);

  return (
    <div className="step-strip">
      {steps.map((s, i) => {
        const si = order.indexOf(s.id === "results" ? "results" : (s.id as Phase));
        const isDone = cur > si || (s.id === "results" && phase === "done");
        const isActive =
          cur === si ||
          (s.id === "results" &&
            (phase === "results" || phase === "processing" || phase === "done"));
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
