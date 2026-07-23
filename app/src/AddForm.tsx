import { useState } from "react";
import { errMsg, proposeAdd, type EventInput, type Proposal } from "./data";
import type { ProposedTask } from "../../src/llm/types";

const pad = (n: number) => String(n).padStart(2, "0");
function defaultDateTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const HHMM = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export function AddForm({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [kind, setKind] = useState<"recurring" | "once">("once");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [quota, setQuota] = useState("1");
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [fixedTime, setFixedTime] = useState(false); // recurring: pin a time-of-day
  const [atTime, setAtTime] = useState("09:00");
  const [exactTime, setExactTime] = useState(true);
  const [when, setWhen] = useState(defaultDateTime);
  const [onDate, setOnDate] = useState(defaultDate);

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [unplaced, setUnplaced] = useState<string[] | null>(null); // "couldn't fit" notice
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Apply a proposal and either close, or stay open showing what couldn't fit. */
  async function applyAndClose(p: Proposal) {
    const { conflicts } = await p.apply();
    onChanged();
    if (conflicts.length) {
      setUnplaced(conflicts);
      setProposal(null);
      setBusy(false);
    } else {
      onClose();
    }
  }

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const dur = Math.max(5, Number(minutes) || 30);
      let p: Proposal;
      if (kind === "recurring") {
        const task: ProposedTask = {
          id: `${title.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30)}-${Date.now()}`,
          title: title.trim(),
          durationMin: dur,
          quota: Math.max(1, Number(quota) || 1),
          period,
          ...(fixedTime ? { fixedTimeMin: HHMM(atTime) } : {}),
        };
        p = await proposeAdd([task], []);
      } else {
        const ev: EventInput = exactTime
          ? { title: title.trim(), durationMin: dur, startAt: when, day: null }
          : { title: title.trim(), durationMin: dur, startAt: null, day: onDate };
        p = await proposeAdd([], [ev]);
      }
      if (p.moves.length || p.removes.length) {
        setProposal(p);
        setBusy(false);
      } else {
        await applyAndClose(p);
      }
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  async function confirmApply() {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      await applyAndClose(proposal);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Add">
        <div className="modal-head">
          <h3 style={{ margin: 0, fontSize: "var(--text-md)" }}>{unplaced ? "Saved — but no room" : proposal ? "Confirm changes" : "Add to your week"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {unplaced ? (
          <>
            <p className="muted small" style={{ marginTop: -6 }}>
              Saved, but the week is too full to place {unplaced.length === 1 ? "it" : "everything"}:
            </p>
            <ul className="move-list">
              {unplaced.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            <p className="faint small">Free up time (shorten or remove a task, or adjust your fixed hours) and it'll slot in on the next re-plan.</p>
            <div className="modal-foot">
              <div className="spacer" />
              <button onClick={onClose}>Done</button>
            </div>
          </>
        ) : proposal ? (
          <>
            <p className="muted small" style={{ marginTop: -6 }}>Adding this will move existing blocks:</p>
            <ul className="move-list">
              {proposal.moves.map((m, i) => (
                <li key={i}><strong>{m.title}</strong> <span className="muted">{m.from} → {m.to}</span></li>
              ))}
              {proposal.removes.map((r, i) => (
                <li key={`r${i}`}><strong>{r}</strong> <span className="muted">removed</span></li>
              ))}
            </ul>
            {error && <div className="error small">{error}</div>}
            <div className="modal-foot">
              <div className="spacer" />
              <button className="ghost" disabled={busy} onClick={() => setProposal(null)}>Back</button>
              <button disabled={busy} onClick={confirmApply}>Apply</button>
            </div>
          </>
        ) : (
          <>
            <div className="seg full">
              <button className={kind === "once" ? "on" : ""} onClick={() => setKind("once")} type="button">One-time</button>
              <button className={kind === "recurring" ? "on" : ""} onClick={() => setKind("recurring")} type="button">Recurring task</button>
            </div>

            <div className="fields">
              <label className="stack">
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "once" ? "e.g. Dentist appointment" : "e.g. Read"} autoFocus />
              </label>

              <div className="field-row">
                <label>
                  <span>Minutes {kind === "recurring" ? "each" : ""}</span>
                  <input type="number" min={5} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </label>
                {kind === "recurring" && (
                  <label>
                    <span>How often</span>
                    <div className="freq">
                      <input type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} />
                      <div className="seg">
                        <button className={period === "day" ? "on" : ""} onClick={() => setPeriod("day")} type="button">/day</button>
                        <button className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")} type="button">/week</button>
                      </div>
                    </div>
                  </label>
                )}
              </div>

              {kind === "recurring" && (
                <>
                  <label className="check-row">
                    <input type="checkbox" checked={fixedTime} onChange={(e) => setFixedTime(e.target.checked)} />
                    <span>At a specific time each time</span>
                  </label>
                  {fixedTime && (
                    <label className="stack">
                      <span>Time</span>
                      <input type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
                    </label>
                  )}
                </>
              )}

              {kind === "once" && (
                <>
                  <label className="check-row">
                    <input type="checkbox" checked={exactTime} onChange={(e) => setExactTime(e.target.checked)} />
                    <span>At a specific time</span>
                  </label>
                  {exactTime ? (
                    <label className="stack">
                      <span>When</span>
                      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                    </label>
                  ) : (
                    <label className="stack">
                      <span>Day (it'll find a slot)</span>
                      <input type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
                    </label>
                  )}
                </>
              )}
            </div>

            {error && <div className="error small">{error}</div>}
            <div className="modal-foot">
              <div className="spacer" />
              <button className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
              <button disabled={busy || !title.trim()} onClick={submit}>{busy ? "…" : "Add"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
