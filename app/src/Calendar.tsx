import { useEffect, useMemo, useRef, useState } from "react";
import { fetchWeek, weekStart, type PlannedBlock } from "./supabase";
import { listFixedSchedules, type FixedSchedule } from "./data";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PX_PER_MIN = 1; // 1440px tall day
const VIEW_START_MIN = 7 * 60; // scroll here initially
const COMPACT_BELOW = 30; // px: below this, collapse title+time to one line

// Curated, cohesive categorical palette (OKLCH, one hue per family) — assigned
// stably per task title. Not a random rainbow: fixed L/C keeps blocks harmonious.
const HUES = [195, 262, 150, 82, 18, 320, 225, 128];
const paletteFor = (title: string) => {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const hue = HUES[h % HUES.length];
  return {
    bg: `oklch(0.47 0.09 ${hue})`,
    edge: `oklch(0.62 0.10 ${hue})`,
    ink: `oklch(0.97 0.03 ${hue})`,
  };
};

const timeLabel = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();

interface Positioned {
  block: PlannedBlock;
  day: number;
  top: number;
  height: number;
  startMin: number;
  endMin: number;
  time: string;
  compact: boolean;
  bg: string;
  edge: string;
  ink: string;
  col: number; // column index within its overlap cluster
  cols: number; // total columns in that cluster
}

/**
 * Assign side-by-side columns to overlapping blocks within one day (Google-
 * Calendar style): sweep by start time, reuse a column once its last block has
 * ended, and give every block in a contiguous overlap cluster the same column
 * count so they share the day's width evenly.
 */
function packColumns(items: Positioned[]): void {
  const evs = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let cluster: Positioned[] = [];
  let clusterEnd = -Infinity;
  const colEnd: number[] = []; // end minute of the last block in each active column

  const flush = () => {
    for (const it of cluster) it.cols = colEnd.length;
    cluster = [];
    colEnd.length = 0;
  };

  for (const ev of evs) {
    if (ev.startMin >= clusterEnd) flush(); // no overlap with current cluster
    let placed = false;
    for (let c = 0; c < colEnd.length; c++) {
      if (colEnd[c] <= ev.startMin) {
        ev.col = c;
        colEnd[c] = ev.endMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      ev.col = colEnd.length;
      colEnd.push(ev.endMin);
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  flush();
}

export function Calendar({ reloadKey = 0, onSelect }: { reloadKey?: number; onSelect: (b: PlannedBlock) => void }) {
  const [start] = useState(() => weekStart());
  const [blocks, setBlocks] = useState<PlannedBlock[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setLoading(true);
    fetchWeek(start)
      .then(setBlocks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    listFixedSchedules()
      .then((f) => setFixed(f.filter((x) => x.showOnCalendar)))
      .catch(() => setFixed([]));
  }, [start, reloadKey]);

  useEffect(() => {
    if (!loading && scrollRef.current) scrollRef.current.scrollTop = VIEW_START_MIN * PX_PER_MIN - 40;
  }, [loading]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const todayIndex = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - start.getTime()) / 86_400_000,
  );
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const positioned = useMemo<Positioned[]>(() => {
    const items = blocks.map((b) => {
      const s = new Date(b.starts_at);
      const e = new Date(b.ends_at);
      const day = Math.floor((new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime() - start.getTime()) / 86_400_000);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const rawDur = (e.getTime() - s.getTime()) / 60000;
      const durMin = Math.max(16, rawDur);
      return {
        block: b,
        day,
        top: startMin * PX_PER_MIN,
        height: durMin * PX_PER_MIN,
        startMin,
        endMin: startMin + rawDur, // real end for overlap math (not the 16-min floor)
        time: timeLabel(s),
        compact: durMin * PX_PER_MIN < COMPACT_BELOW,
        col: 0,
        cols: 1,
        ...paletteFor(b.title),
      };
    });
    // Lay overlapping blocks side by side, one day at a time.
    for (let d = 0; d < 7; d++) packColumns(items.filter((p) => p.day === d));
    return items;
  }, [blocks, start]);

  const weekLabel = `${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date(start.getTime() + 6 * 86_400_000).toLocaleDateString([], { month: "short", day: "numeric" })}`;

  return (
    <div className="cal">
      <div className="cal-head">
        <h2>This week</h2>
        <span className="faint small mono">{weekLabel}</span>
        <span className="dot" />
        {loading ? (
          <span className="faint small">loading…</span>
        ) : error ? (
          <span className="error small">{error}</span>
        ) : (
          <span className="faint small">{blocks.length} blocks</span>
        )}
      </div>

      <div className="cal-grid-head">
        <div className="gutter" />
        {DAYS.map((d, i) => {
          const date = new Date(start.getTime() + i * 86_400_000);
          return (
            <div key={d} className={`col-head${i === todayIndex ? " today" : ""}`}>
              <span className="dow">{d}</span>
              <span className="dom">{date.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-body" style={{ height: 1440 * PX_PER_MIN }}>
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label" style={{ top: h * 60 * PX_PER_MIN }}>
                {h === 0 ? "" : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`}
              </div>
            ))}
          </div>
          {DAYS.map((_, day) => (
            <div key={day} className={`day-col${day === todayIndex ? " today" : ""}`}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="hour-line" style={{ top: h * 60 * PX_PER_MIN }} />
              ))}
              {fixed
                .filter((f) => f.days.length === 0 || f.days.includes(day))
                .map((f) => (
                  <div
                    key={f.id}
                    className="fixed-block"
                    style={{ top: f.startMin * PX_PER_MIN, height: (f.endMin - f.startMin) * PX_PER_MIN }}
                    title={`${f.title} (fixed)`}
                  >
                    <span className="fixed-label">{f.title}</span>
                  </div>
                ))}
              {day === todayIndex && <div className="now-line" style={{ top: nowMin * PX_PER_MIN }} aria-label="current time" />}
              {positioned
                .filter((p) => p.day === day)
                .map((p) => (
                  <button
                    key={p.block.id}
                    className={`block${p.compact ? " compact" : ""} st-${p.block.status}`}
                    style={
                      {
                        top: p.top,
                        height: p.height,
                        // Share the column's width when blocks overlap; the
                        // 3px gutter is kept via calc so neighbours don't touch.
                        left: p.cols > 1 ? `calc(3px + ${(p.col / p.cols) * 100}% - ${(p.col / p.cols) * 6}px)` : undefined,
                        width: p.cols > 1 ? `calc(${(100 / p.cols)}% - 6px)` : undefined,
                        right: p.cols > 1 ? "auto" : undefined,
                        "--block-bg": p.bg,
                        "--block-edge": p.edge,
                        "--block-ink": p.ink,
                      } as React.CSSProperties
                    }
                    title={`${p.block.title} · ${p.time}`}
                    onClick={() => onSelect(p.block)}
                  >
                    {p.compact ? (
                      <div className="block-title">
                        <span className="block-time-inline mono">{p.time}</span> {p.block.title}
                      </div>
                    ) : (
                      <>
                        <div className="block-title">{p.block.title}</div>
                        <div className="block-time mono">{p.time}</div>
                      </>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
