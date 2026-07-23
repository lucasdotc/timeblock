import { useEffect, useState } from "react";
import { fetchDay, type PlannedBlock } from "./supabase";
import { setBlockStatus } from "./data";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();

export function Today({ reloadKey = 0, onSelect, onChanged }: { reloadKey?: number; onSelect: (b: PlannedBlock) => void; onChanged: () => void }) {
  const [blocks, setBlocks] = useState<PlannedBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchDay()
      .then(setBlocks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  async function toggle(b: PlannedBlock, next: "done" | "skipped") {
    const status = b.status === next ? "planned" : next;
    // optimistic
    setBlocks((cur) => cur.map((x) => (x.id === b.id ? { ...x, status } : x)));
    try {
      await setBlockStatus(b.id, status);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const done = blocks.filter((b) => b.status === "done").length;
  const total = blocks.length;
  const now = Date.now();
  const todayLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="today">
      <div className="cal-head">
        <h2>Today</h2>
        <span className="faint small mono">{todayLabel}</span>
        <span className="dot" />
        {loading ? <span className="faint small">loading…</span> : <span className="faint small">{done}/{total} done</span>}
      </div>

      {total > 0 && (
        <div className="progress" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      )}

      <div className="today-list">
        {error && <div className="error small">{error}</div>}
        {!loading && total === 0 && <div className="cal-empty">Nothing scheduled today. Ask the assistant to add something.</div>}
        {blocks.map((b) => {
          const missed = b.status === "planned" && new Date(b.ends_at).getTime() < now;
          return (
            <div key={b.id} className={`today-row st-${b.status}${missed ? " missed" : ""}`}>
              <button
                className={`check${b.status === "done" ? " on" : ""}`}
                aria-label={b.status === "done" ? "Mark not done" : "Mark done"}
                onClick={() => toggle(b, "done")}
              >
                {b.status === "done" ? "✓" : ""}
              </button>
              <button className="today-main" onClick={() => onSelect(b)}>
                <span className="today-time mono">{time(b.starts_at)}</span>
                <span className="today-title">{b.title}</span>
                {missed && <span className="missed-tag">missed</span>}
                {b.note && <span className="note-dot" title={b.note}>•</span>}
              </button>
              <button className="skip-btn" onClick={() => toggle(b, "skipped")} aria-label="Skip">
                {b.status === "skipped" ? "skipped" : "skip"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
