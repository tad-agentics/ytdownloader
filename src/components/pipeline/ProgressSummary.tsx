import type { Phase } from "./StepStrip";

const fmtMB = (mb: number) => (mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

interface ProgressSummaryProps {
  phase: Phase;
  done: number;
  total: number;
  storedMb: number;
  failed: number;
}

export default function ProgressSummary({
  phase,
  done,
  total,
  storedMb,
  failed,
}: ProgressSummaryProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const remaining = total - done - failed;

  const label =
    phase === "done"
      ? `Done — ${done} stored, ${fmtMB(storedMb)} to R2`
      : phase === "stopped"
        ? `Stopped — ${done} stored, ${remaining} remaining`
        : `${done}/${total} complete`;

  return (
    <div className={`prog-summary${phase === "stopped" ? " stopped" : ""}`}>
      <span className="prog-label">{pct}%</span>
      <div className="prog-overall-bar">
        <div
          className={`prog-overall-fill${phase === "stopped" ? " stopped" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="prog-label">{label}</span>
    </div>
  );
}
