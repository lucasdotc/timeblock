import { useEffect, useRef, useState } from "react";
import { deleteTasks, errMsg, parse, proposeAdd, proposeEdit, proposeRearrange, rescheduleAndSave, taskTitles, type Proposal } from "./data";

interface Msg {
  who: "you" | "app";
  text: string;
  greeting?: boolean;
}

export function Chat({ onChanged }: { onChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([
    { who: "app", greeting: true, text: "Tell me what you'd like to schedule — like “3 leetcode a day”, “dentist Tuesday at 3pm”, or “yoga twice a week”. I can also remove tasks: “delete yoga”." },
  ]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"day" | "week">("week");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [proposal, setProposal] = useState<{ p: Proposal; successMsg: string } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, pendingDelete, proposal]);

  function say(who: Msg["who"], text: string) {
    setMessages((m) => [...m, { who, text }]);
  }

  function clearPending() {
    setPendingDelete(null);
    setProposal(null);
  }

  /** Apply directly if nothing existing moves; otherwise show the moves + confirm. */
  async function applyOrConfirm(p: Proposal, successMsg: string) {
    if (p.moves.length || p.removes.length) {
      const list = [
        ...p.moves.map((m) => `• ${m.title}: ${m.from} → ${m.to}`),
        ...p.removes.map((r) => `• ${r} (removed)`),
      ].join("\n");
      say("app", `${successMsg}\n\nThis rearranges existing blocks:\n${list}\n\nApply?`);
      setProposal({ p, successMsg });
    } else {
      const { placed, conflicts } = await p.apply();
      say("app", `${successMsg} Re-planned — ${placed} blocks.${conflicts.length ? " ⚠ Some didn't fit." : ""}`);
      onChanged();
    }
  }

  async function send() {
    const request = input.trim();
    if (!request || busy) return;
    setInput("");
    clearPending();
    say("you", request);
    setBusy(true);
    try {
      const result = await parse(request, scope);
      if (result.kind === "clarify") {
        say("app", "A couple of things first:\n" + result.questions.map((q) => `• ${q}`).join("\n"));
      } else if (result.kind === "events") {
        const p = await proposeAdd([], result.events);
        await applyOrConfirm(p, `Added ${result.events.map((e) => e.title).join(", ")}.`);
      } else if (result.kind === "edit") {
        const p = await proposeEdit(result.edits);
        await applyOrConfirm(p, result.edits.map((e) => e.summary).join(" "));
      } else if (result.kind === "rearrange") {
        const p = await proposeRearrange(result.rearrange);
        await applyOrConfirm(p, result.rearrange.summary);
      } else if (result.kind === "delete") {
        const titles = await taskTitles(result.taskIds);
        say("app", `This will remove ${titles.length} task${titles.length === 1 ? "" : "s"} and their blocks:\n${titles.map((t) => `• ${t}`).join("\n")}\n\nConfirm below.`);
        setPendingDelete(result.taskIds);
      } else {
        const summary = result.tasks.map((t) => `• ${t.title} — ${t.durationMin}m ×${t.quota}/${t.period}${t.estimateNote ? ` (${t.estimateNote})` : ""}`).join("\n");
        const p = await proposeAdd(result.tasks, []);
        await applyOrConfirm(p, `Added:\n${summary}`);
      }
    } catch (e: unknown) {
      say("app", `Something went wrong: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal() {
    if (!proposal || busy) return;
    const { p, successMsg } = proposal;
    setProposal(null);
    setBusy(true);
    try {
      const { placed } = await p.apply();
      say("app", `${successMsg} Re-planned — ${placed} blocks.`);
      onChanged();
    } catch (e: unknown) {
      say("app", `Something went wrong: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    const ids = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      await deleteTasks(ids);
      const { placed } = await rescheduleAndSave();
      say("app", `Removed. Re-planned — ${placed} blocks.`);
      onChanged();
    } catch (e: unknown) {
      say("app", `Couldn't remove: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel(msg: string) {
    clearPending();
    say("app", msg);
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.who}${m.greeting ? " greeting" : ""}`}>
            {m.text.split("\n").map((line, j) => (
              <div key={j}>{line || " "}</div>
            ))}
          </div>
        ))}
        {busy && (
          <div className="msg app">
            <span className="thinking" aria-label="thinking"><span /><span /><span /></span>
          </div>
        )}
        {pendingDelete && !busy && (
          <div className="confirm-bar">
            <button className="danger" onClick={confirmDelete}>Remove {pendingDelete.length} task{pendingDelete.length === 1 ? "" : "s"}</button>
            <button className="ghost" onClick={() => cancel("Okay, kept them.")}>Cancel</button>
          </div>
        )}
        {proposal && !busy && (
          <div className="confirm-bar">
            <button onClick={confirmProposal}>Apply changes</button>
            <button className="ghost" onClick={() => cancel("Okay, left your schedule as-is.")}>Cancel</button>
          </div>
        )}
      </div>
      <div className="scope-row">
        <span className="faint small">Requests apply to</span>
        <div className="seg">
          <button className={scope === "day" ? "on" : ""} onClick={() => setScope("day")} type="button">Today</button>
          <button className={scope === "week" ? "on" : ""} onClick={() => setScope("week")} type="button">Whole week</button>
        </div>
      </div>
      <div className="chat-input">
        <textarea
          rows={2}
          placeholder="Schedule, edit, or remove something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
