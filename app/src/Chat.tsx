import { useEffect, useRef, useState } from "react";
import { applyPlan, describeOps, errMsg, previewPlan, runAgent, type AgentOp } from "./data";

interface Msg {
  who: "you" | "app";
  text: string;
  greeting?: boolean;
}

export function Chat({ onChanged }: { onChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([
    { who: "app", greeting: true, text: "Tell me what you'd like to do. I can add habits (“3 leetcode a day”), schedule events (“dentist Tuesday at 3pm”), change or remove tasks, and handle several steps at once (“make soccer daily and drop job applications”)." },
  ]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"day" | "week">("week");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ ops: AgentOp[] } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, plan]);

  function say(who: Msg["who"], text: string) {
    setMessages((m) => [...m, { who, text }]);
  }

  async function send() {
    const request = input.trim();
    if (!request || busy) return;
    setInput("");
    setPlan(null);
    say("you", request);
    setBusy(true);
    try {
      const { operations, summary } = await runAgent(request, scope);
      if (!operations.length) {
        // Nothing to do, or the assistant asked a question.
        say("app", summary || "I couldn't find anything to change there.");
      } else {
        const lines = await describeOps(operations);
        const { autoApply, moves } = await previewPlan(operations);
        if (autoApply) {
          // A pure add that fits: apply straight away, no confirm click.
          const { placed, conflicts } = await applyPlan(operations);
          say("app", `${summary} Done — ${placed} blocks.${conflicts.length ? " ⚠ Some didn't fit." : ""}`);
          onChanged();
        } else {
          const moveLines = moves.map((m) => `• moves ${m.title}: ${m.from} → ${m.to}`);
          say("app", `${summary}\n\n${lines.map((l) => `• ${l}`).join("\n")}${moveLines.length ? `\n\nThis also moves existing blocks:\n${moveLines.join("\n")}` : ""}\n\nApply this?`);
          setPlan({ ops: operations });
        }
      }
    } catch (e: unknown) {
      say("app", `Something went wrong: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPlan() {
    if (!plan || busy) return;
    const ops = plan.ops;
    setPlan(null);
    setBusy(true);
    try {
      const { placed, conflicts } = await applyPlan(ops);
      say("app", `Done. Re-planned — ${placed} blocks.${conflicts.length ? " ⚠ Some didn't fit." : ""}`);
      onChanged();
    } catch (e: unknown) {
      say("app", `Something went wrong: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPlan(null);
    say("app", "Okay, left your schedule as-is.");
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
        {plan && !busy && (
          <div className="confirm-bar">
            <button onClick={confirmPlan}>Apply changes</button>
            <button className="ghost" onClick={cancel}>Cancel</button>
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
          placeholder="Tell the assistant what to do…"
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
