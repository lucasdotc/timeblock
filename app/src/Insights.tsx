import { useEffect, useState } from "react";
import { applyInsight, durationInsights, type Insight } from "./data";

/**
 * Habit-learning banner: surfaces tasks whose logged actual times consistently
 * differ from their planned estimate, and offers a one-click adjustment.
 */
export function Insights({ reloadKey = 0, onChanged }: { reloadKey?: number; onChanged: () => void }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    durationInsights()
      .then(setInsights)
      .catch(() => setInsights([]));
  }, [reloadKey]);

  const visible = insights.filter((i) => !dismissed.has(i.taskId));
  if (visible.length === 0) return null;

  async function apply(i: Insight) {
    setBusy(true);
    try {
      await applyInsight(i.taskId, i.suggested);
      setDismissed((d) => new Set(d).add(i.taskId));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="insights">
      {visible.map((i) => {
        const longer = i.suggested > i.planned;
        return (
          <div key={i.taskId} className="insight">
            <span className={`insight-icon ${longer ? "up" : "down"}`}>{longer ? "↑" : "↓"}</span>
            <div className="insight-text">
              <strong>{i.title}</strong> is averaging <strong>{i.avgActual}m</strong> across {i.samples} sessions — {longer ? "longer" : "shorter"} than the {i.planned}m planned.
            </div>
            <button disabled={busy} onClick={() => apply(i)}>Set to {i.suggested}m</button>
            <button className="icon-btn" disabled={busy} onClick={() => setDismissed((d) => new Set(d).add(i.taskId))} aria-label="Dismiss">✕</button>
          </div>
        );
      })}
    </div>
  );
}
