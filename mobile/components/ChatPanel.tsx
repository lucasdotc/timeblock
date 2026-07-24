import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { applyPlan, describeOps, errMsg, previewPlan, runAgent, type AgentOp } from "../lib/data";
import { C } from "../theme";

interface Msg {
  who: "you" | "app";
  text: string;
}

const GREETING =
  "Tell me what to do. I can add habits (“3 leetcode a day”), schedule events (“dentist Tuesday at 3pm”), change or remove tasks, and handle several steps at once (“make soccer daily and drop job applications”).";

/** Full-screen slide-up chat, routed through the agent. */
export function ChatPanel({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([{ who: "app", text: GREETING }]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"day" | "week">("week");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ ops: AgentOp[] } | null>(null);
  const logRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => logRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
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
        say("app", summary || "I couldn't find anything to change there.");
      } else {
        const lines = await describeOps(operations);
        const { autoApply, moves } = await previewPlan(operations);
        if (autoApply) {
          const { placed, conflicts } = await applyPlan(operations);
          say("app", `${summary} Done — ${placed} blocks.${conflicts.length ? " ⚠ Some didn't fit." : ""}`);
          onChanged();
        } else {
          const moveLines = moves.map((m) => `• moves ${m.title}: ${m.from} → ${m.to}`);
          say("app", `${summary}\n\n${lines.map((l) => `• ${l}`).join("\n")}${moveLines.length ? `\n\nThis also moves existing blocks:\n${moveLines.join("\n")}` : ""}\n\nApply this?`);
          setPlan({ ops: operations });
        }
      }
    } catch (e) {
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
    } catch (e) {
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView style={s.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.grabber} />
          <View style={s.head}>
            <Text style={s.title}>Assistant</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={s.close}>Done</Text></TouchableOpacity>
          </View>

          <ScrollView style={s.log} ref={logRef} contentContainerStyle={{ padding: 14, gap: 10 }}>
            {messages.map((m, i) => (
              <View key={i} style={[s.msg, m.who === "you" ? s.you : s.app]}>
                <Text style={m.who === "you" ? s.youText : s.appText}>{m.text}</Text>
              </View>
            ))}
            {busy && (
              <View style={[s.msg, s.app]}>
                <ActivityIndicator color={C.muted} />
              </View>
            )}

            {plan && !busy && (
              <View style={s.confirmBar}>
                <TouchableOpacity style={s.primary} onPress={confirmPlan}>
                  <Text style={s.primaryText}>Apply changes</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.ghost} onPress={cancel}>
                  <Text style={s.ghostText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          <View style={s.scopeRow}>
            <Text style={s.scopeLabel}>Requests apply to</Text>
            <View style={s.seg}>
              <TouchableOpacity style={[s.segBtn, scope === "day" && s.segOn]} onPress={() => setScope("day")}>
                <Text style={[s.segText, scope === "day" && s.segTextOn]}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.segBtn, scope === "week" && s.segOn]} onPress={() => setScope("week")}>
                <Text style={[s.segText, scope === "week" && s.segTextOn]}>Whole week</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.inputBar}>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="Schedule, edit, or remove something…"
              placeholderTextColor={C.faint}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline
            />
            <TouchableOpacity style={[s.send, (busy || !input.trim()) && { opacity: 0.5 }]} onPress={send} disabled={busy || !input.trim()}>
              {busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={s.sendText}>Send</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { height: "82%", backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 8 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  title: { color: C.ink, fontSize: 16, fontWeight: "700" },
  close: { color: C.accent, fontSize: 15, fontWeight: "600" },
  log: { flex: 1 },
  msg: { maxWidth: "88%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  you: { alignSelf: "flex-end", backgroundColor: C.accent },
  app: { alignSelf: "flex-start", backgroundColor: C.surface2 },
  youText: { color: C.accentInk, fontSize: 14, lineHeight: 20 },
  appText: { color: C.ink, fontSize: 14, lineHeight: 20 },
  confirmBar: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 2 },
  primary: { flex: 1, backgroundColor: C.accent, borderRadius: 9, paddingVertical: 11, alignItems: "center" },
  primaryText: { color: C.accentInk, fontWeight: "700" },
  danger: { flex: 1, backgroundColor: C.err ?? "#c0392b", borderRadius: 9, paddingVertical: 11, alignItems: "center" },
  dangerText: { color: "#fff", fontWeight: "700" },
  ghost: { flex: 1, backgroundColor: C.surface2, borderRadius: 9, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: C.line },
  ghostText: { color: C.ink, fontWeight: "600" },
  scopeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  scopeLabel: { color: C.faint, fontSize: 12 },
  seg: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: 8, padding: 3, gap: 2 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  segOn: { backgroundColor: C.surface },
  segText: { color: C.muted, fontSize: 12, fontWeight: "500" },
  segTextOn: { color: C.ink },
  inputBar: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: C.line, alignItems: "flex-end" },
  input: { flex: 1, maxHeight: 100, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontSize: 15 },
  send: { backgroundColor: C.accent, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center", justifyContent: "center" },
  sendText: { color: C.accentInk, fontWeight: "700", fontSize: 14 },
});
