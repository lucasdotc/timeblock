import { useEffect, useState } from "react";
import {
  createFixedSchedule,
  deleteFixedSchedule,
  errMsg,
  listFixedSchedules,
  rescheduleAndSave,
  updateFixedSchedule,
  type FixedSchedule,
} from "./data";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
const minToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const daysLabel = (days: number[]) =>
  !days.length ? "Every day" : [...days].sort((a, b) => a - b).map((d) => DAYS[d]).join(" · ");

interface Draft {
  id: string | null;
  title: string;
  days: number[];
  start: string; // HH:MM
  end: string;
  showOnCalendar: boolean;
}
const emptyDraft = (): Draft => ({ id: null, title: "", days: [], start: "09:00", end: "17:00", showOnCalendar: true });
const toDraft = (f: FixedSchedule): Draft => ({
  id: f.id,
  title: f.title,
  days: f.days,
  start: minToTime(f.startMin),
  end: minToTime(f.endMin),
  showOnCalendar: f.showOnCalendar,
});

export function FixedHours({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<FixedSchedule[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => listFixedSchedules().then(setItems).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, []);

  const badTime = draft ? timeToMin(draft.end) <= timeToMin(draft.start) : false;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await rescheduleAndSave(); // fixed hours are scheduling walls — re-plan around them
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft || !draft.title.trim() || badTime) return;
    const payload = {
      title: draft.title.trim(),
      days: draft.days,
      startMin: timeToMin(draft.start),
      endMin: timeToMin(draft.end),
      showOnCalendar: draft.showOnCalendar,
    };
    await run(async () => {
      if (draft.id) await updateFixedSchedule(draft.id, payload);
      else await createFixedSchedule(payload);
    });
    setDraft(null);
  }

  async function toggleShow(f: FixedSchedule) {
    await run(() => updateFixedSchedule(f.id, { showOnCalendar: !f.showOnCalendar }));
  }
  async function remove(f: FixedSchedule) {
    await run(() => deleteFixedSchedule(f.id));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Fixed hours">
        <div className="modal-head">
          <h3 style={{ margin: 0, fontSize: "var(--text-md)" }}>Fixed hours</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted small" style={{ marginTop: -8 }}>
          Sleep, work, classes — times the scheduler always keeps free. Toggle the eye to show them on the calendar.
        </p>

        {draft ? (
          <div className="fields">
            <label className="stack">
              <span>Name</span>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Work, Sleep, Class" autoFocus />
            </label>
            <div className="field-row">
              <label className="stack">
                <span>Start</span>
                <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              </label>
              <label className="stack">
                <span>End</span>
                <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
              </label>
            </div>
            {badTime && <div className="error small" style={{ marginTop: -6 }}>End must be after start.</div>}
            <div className="stack">
              <span className="faint small">Days <span className="faint">(none = every day)</span></span>
              <div className="day-toggle">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    className={draft.days.includes(i) ? "on" : ""}
                    onClick={() => setDraft({ ...draft, days: draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i] })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={draft.showOnCalendar} onChange={(e) => setDraft({ ...draft, showOnCalendar: e.target.checked })} />
              <span>Show on calendar</span>
            </label>
            {error && <div className="error small">{error}</div>}
            <div className="modal-foot">
              <div className="spacer" />
              <button className="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
              <button disabled={busy || !draft.title.trim() || badTime} onClick={saveDraft}>{draft.id ? "Save" : "Add"}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="fixed-list">
              {items === null ? (
                <div className="muted small">Loading…</div>
              ) : items.length === 0 ? (
                <div className="faint small">No fixed hours yet. Add work, sleep, or anything the scheduler should plan around.</div>
              ) : (
                items.map((f) => (
                  <div key={f.id} className="fixed-row">
                    <button className="fixed-main" onClick={() => setDraft(toDraft(f))} title="Edit">
                      <span className="fixed-title">{f.title}</span>
                      <span className="fixed-meta mono">{minToTime(f.startMin)}–{minToTime(f.endMin)} · {daysLabel(f.days)}</span>
                    </button>
                    <button
                      className={`eye${f.showOnCalendar ? " on" : ""}`}
                      disabled={busy}
                      onClick={() => toggleShow(f)}
                      title={f.showOnCalendar ? "Shown on calendar" : "Hidden from calendar"}
                      aria-label="Toggle calendar visibility"
                    >
                      {f.showOnCalendar ? "👁" : "◌"}
                    </button>
                    <button className="icon-btn" disabled={busy} onClick={() => remove(f)} aria-label="Delete">✕</button>
                  </div>
                ))
              )}
            </div>
            {error && <div className="error small">{error}</div>}
            <div className="modal-foot">
              <button disabled={busy} onClick={() => setDraft(emptyDraft())}>+ Add fixed hours</button>
              <div className="spacer" />
              <button className="ghost" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
