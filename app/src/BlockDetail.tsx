import { useEffect, useState } from "react";
import type { PlannedBlock } from "./supabase";
import {
  applyReschedule,
  deleteBlock,
  deleteTask,
  errMsg,
  getTask,
  keepOverlapped,
  markDoneWithActual,
  moveToAccommodate,
  overlappingBlocks,
  rescheduleAndSave,
  setBlockNote,
  setBlockStatus,
  suggestReschedule,
  updateBlockTime,
  updateBlockTitle,
  updateTask,
  type OverlapHit,
  type Suggestion,
  type TaskRow,
} from "./data";

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function BlockDetail({ block, onClose, onChanged }: { block: PlannedBlock; onClose: () => void; onChanged: () => void }) {
  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = new Date(block.starts_at);
  const e = new Date(block.ends_at);
  const plannedMin = Math.round((e.getTime() - s.getTime()) / 60_000);
  const initialStart = toLocalInput(block.starts_at);
  const initialEnd = toLocalInput(block.ends_at);

  const [title, setTitle] = useState(block.title);
  const [startLocal, setStartLocal] = useState(initialStart);
  const [endLocal, setEndLocal] = useState(initialEnd);
  const [quota, setQuota] = useState("");
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState(block.note ?? "");
  const [actual, setActual] = useState(String(plannedMin));
  const [suggestion, setSuggestion] = useState<Suggestion | null | "none">(null);
  const [overlap, setOverlap] = useState<OverlapHit[] | null>(null);
  const [overlapStep, setOverlapStep] = useState<1 | 2>(1);

  const when = `${s.toLocaleDateString([], { weekday: "long" })}, ${s.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${e.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const done = block.status === "done";

  // Duration is now derived from the start/end fields (not entered directly).
  const durationMin = Math.max(5, Math.round((new Date(endLocal).getTime() - new Date(startLocal).getTime()) / 60_000));
  const timeChanged = startLocal !== initialStart || endLocal !== initialEnd;
  const badTime = new Date(endLocal).getTime() <= new Date(startLocal).getTime();

  // Moving the start drags the whole block (end follows to keep length); editing
  // the end resizes it. So a move is one edit, a resize is one edit.
  function onStartChange(v: string) {
    const delta = new Date(v).getTime() - new Date(startLocal).getTime();
    setStartLocal(v);
    if (!Number.isNaN(delta)) setEndLocal(toLocalInput(new Date(new Date(endLocal).getTime() + delta).toISOString()));
  }

  useEffect(() => {
    if (!block.task_id) {
      setLoading(false);
      return;
    }
    getTask(block.task_id)
      .then((t) => {
        setTask(t);
        if (t) {
          setTitle(t.title);
          setQuota(String(t.quota));
          setPeriod(t.period === "week" ? "week" : "day");
          setDescription(t.description ?? "");
        }
      })
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoading(false));
  }, [block.task_id]);

  async function run(fn: () => Promise<void>, close = true) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      if (close) onClose();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  /** Persist edits that don't touch other blocks' placement. */
  async function commitSave() {
    if (timeChanged) await updateBlockTime(block.id, startLocal, durationMin);
    if (task) {
      const q = Math.max(1, Number(quota) || task.quota);
      // The occurrence's start/end pins it; the task's default length follows the
      // edited span so future auto-placed occurrences match.
      await updateTask(task.id, { title, durationMin, quota: q, period, description });
      await rescheduleAndSave();
    } else if (title !== block.title) {
      await updateBlockTitle(block.id, title);
    }
    if (note !== (block.note ?? "")) await setBlockNote(block.id, note);
  }

  async function save() {
    if (badTime) {
      setError("End time must be after the start time.");
      return;
    }
    // A manual time change might double-book another task — warn first.
    if (timeChanged) {
      setBusy(true);
      setError(null);
      try {
        const hits = await overlappingBlocks(startLocal, durationMin, block.id);
        if (hits.length) {
          setOverlap(hits);
          setOverlapStep(1);
          setBusy(false);
          return;
        }
      } catch (err) {
        setError(errMsg(err));
        setBusy(false);
        return;
      }
    }
    run(commitSave);
  }

  /** Apply title/task/note edits, then resolve the overlap per the chosen mode. */
  async function resolveOverlap(mode: "keep" | "move") {
    if (!overlap) return;
    await run(async () => {
      if (task) {
        const q = Math.max(1, Number(quota) || task.quota);
        await updateTask(task.id, { title, durationMin, quota: q, period, description });
      } else if (title !== block.title) {
        await updateBlockTitle(block.id, title);
      }
      if (note !== (block.note ?? "")) await setBlockNote(block.id, note);
      if (mode === "keep") await keepOverlapped(block.id, startLocal, durationMin, overlap);
      else await moveToAccommodate(block.id, startLocal, durationMin, overlap);
    });
  }

  async function reschedule() {
    setBusy(true);
    setError(null);
    try {
      setSuggestion((await suggestReschedule(block)) ?? "none");
    } catch (err) {
      setError(errMsg(err));
    }
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Block details">
        <div className="modal-head">
          <input className="title-input" value={title} onChange={(ev) => setTitle(ev.target.value)} aria-label="Title" placeholder={block.title} />
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-when">
          {when}
          <span className={`badge st-${block.status}`}>{block.status}</span>
          {block.pinned && <span className="badge pinned">📌 pinned</span>}
        </div>

        {overlap ? (
          <div className="overlap-prompt">
            {overlapStep === 1 ? (
              <>
                <p>
                  Changing <strong>{title}</strong> to{" "}
                  <strong>{new Date(startLocal).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase()}</strong>{" "}
                  overlaps with <strong>{overlap.map((o) => o.title).join(", ")}</strong>. Would you like to continue?
                </p>
                <div className="occurrence-actions">
                  <button className="ghost" disabled={busy} onClick={() => { setOverlap(null); onClose(); }}>Cancel</button>
                  <button disabled={busy} onClick={() => setOverlapStep(2)}>Yes, continue</button>
                </div>
              </>
            ) : (
              <>
                <p>How should they fit together?</p>
                <div className="occurrence-actions stack-actions">
                  <button disabled={busy} onClick={() => resolveOverlap("move")}>Move {overlap.map((o) => o.title).join(", ")} to accommodate</button>
                  <button className="ghost" disabled={busy} onClick={() => resolveOverlap("keep")}>Keep them overlapped</button>
                </div>
                {error && <div className="error small">{error}</div>}
              </>
            )}
          </div>
        ) : loading ? (
          <div className="muted small">Loading…</div>
        ) : (
          <>
            <div className="occurrence-actions">
              <button className={done ? "" : "ghost"} disabled={busy} onClick={() => run(() => (done ? setBlockStatus(block.id, "planned") : markDoneWithActual(block.id, Number(actual) || plannedMin)))}>
                {done ? "✓ Done" : "Mark done"}
              </button>
              <button className="ghost" disabled={busy} onClick={() => run(() => setBlockStatus(block.id, "skipped"))}>Skip</button>
              {task && <button className="ghost" disabled={busy} onClick={reschedule}>Find another time</button>}
            </div>

            {suggestion === "none" && <div className="hint">No free slot fits this week.</div>}
            {suggestion && suggestion !== "none" && (
              <div className="suggestion">
                <span>Move to <strong>{suggestion.label}</strong>?</span>
                <button disabled={busy} onClick={() => run(() => applyReschedule(block.id, suggestion))}>Move here</button>
              </div>
            )}

            <div className="fields">
              <div className="field-row">
                <label className="stack">
                  <span>Start</span>
                  <input type="datetime-local" value={startLocal} onChange={(ev) => onStartChange(ev.target.value)} />
                </label>
                <label className="stack">
                  <span>End</span>
                  <input type="datetime-local" value={endLocal} onChange={(ev) => setEndLocal(ev.target.value)} />
                </label>
              </div>
              <div className="field-sub">
                {badTime ? <span className="error">End must be after start.</span> : <span className="faint">{durationMin} min</span>}
              </div>

              {task && (
                <label className="stack">
                  <span>How often</span>
                  <div className="freq">
                    <input type="number" min={1} value={quota} onChange={(ev) => setQuota(ev.target.value)} />
                    <div className="seg">
                      <button className={period === "day" ? "on" : ""} onClick={() => setPeriod("day")} type="button">/day</button>
                      <button className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")} type="button">/week</button>
                    </div>
                  </div>
                </label>
              )}

              {task && (
                <label className="stack">
                  <span>Description</span>
                  <textarea rows={2} value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder="What this task is about…" />
                </label>
              )}
            </div>

            {!done && (
              <label className="stack">
                <span>How long did it take? (logging this helps the app learn your pace)</span>
                <div className="actual-input">
                  <input type="number" min={1} step={5} value={actual} onChange={(ev) => setActual(ev.target.value)} />
                  <span className="unit">min</span>
                </div>
              </label>
            )}

            <label className="stack">
              <span>Note for this occurrence</span>
              <textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. focus on graph problems" />
            </label>

            {error && <div className="error small">{error}</div>}

            <div className="modal-foot">
              <button className="danger" disabled={busy} onClick={() => run(async () => { if (task) { await deleteTask(task.id); await rescheduleAndSave(); } else { await deleteBlock(block.id); } })}>
                {task ? "Delete task" : "Delete"}
              </button>
              <div className="spacer" />
              <button className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
              <button disabled={busy || badTime} onClick={save}>Save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
