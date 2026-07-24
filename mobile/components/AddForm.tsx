import { useState } from "react";
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
import DateTimePicker from "@react-native-community/datetimepicker";
import { errMsg, proposeAdd, type EventInput, type Proposal, type ProposedTask } from "../lib/data";
import { C } from "../theme";

const localISO = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const localDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function nextHour(): Date {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return d;
}

export function AddForm({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [kind, setKind] = useState<"once" | "recurring">("once");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [quota, setQuota] = useState("1");
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [exactTime, setExactTime] = useState(true);
  const [when, setWhen] = useState(nextHour);
  const [picker, setPicker] = useState<null | "date" | "time">(null);
  const [fixedTime, setFixedTime] = useState(false); // recurring: pin a time-of-day
  const [atTime, setAtTime] = useState(() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; });
  const [recPicker, setRecPicker] = useState(false);

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [unplaced, setUnplaced] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          ...(fixedTime ? { fixedTimeMin: atTime.getHours() * 60 + atTime.getMinutes() } : {}),
        };
        p = await proposeAdd([task], []);
      } else {
        const ev: EventInput = exactTime
          ? { title: title.trim(), durationMin: dur, startAt: localISO(when), day: null }
          : { title: title.trim(), durationMin: dur, startAt: null, day: localDate(when) };
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

  function onPick(_: unknown, d?: Date) {
    if (Platform.OS !== "ios") setPicker(null);
    if (!d) return;
    const next = new Date(when);
    if (picker === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    setWhen(next);
  }

  const dateStr = when.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const timeStr = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={st.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={st.headRow}>
              <Text style={st.title}>{unplaced ? "Saved — but no room" : proposal ? "Confirm changes" : "Add to your week"}</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={onClose}><Text style={st.close}>✕</Text></TouchableOpacity>
            </View>

            {unplaced ? (
              <>
                <Text style={st.muted}>Saved, but the week is too full to place {unplaced.length === 1 ? "it" : "everything"}:</Text>
                <View style={st.moveList}>
                  {unplaced.map((c, i) => (
                    <Text key={i} style={st.moveItem}>{c}</Text>
                  ))}
                </View>
                <Text style={[st.muted, { color: C.faint }]}>Free up time (shorten or remove a task, or adjust your fixed hours) and it'll slot in on the next re-plan.</Text>
                <View style={st.foot}>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={[st.btn, st.primary]} onPress={onClose}><Text style={[st.btnText, { color: C.accentInk }]}>Done</Text></TouchableOpacity>
                </View>
              </>
            ) : proposal ? (
              <>
                <Text style={st.muted}>Adding this will move existing blocks:</Text>
                <View style={st.moveList}>
                  {proposal.moves.map((m, i) => (
                    <Text key={i} style={st.moveItem}><Text style={st.bold}>{m.title}</Text>  {m.from} → {m.to}</Text>
                  ))}
                  {proposal.removes.map((r, i) => (
                    <Text key={`r${i}`} style={st.moveItem}><Text style={st.bold}>{r}</Text>  removed</Text>
                  ))}
                </View>
                {error ? <Text style={st.error}>{error}</Text> : null}
                <View style={st.foot}>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={[st.btn, st.ghost]} disabled={busy} onPress={() => setProposal(null)}><Text style={st.btnText}>Back</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.btn, st.primary]} disabled={busy} onPress={confirmApply}>{busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={[st.btnText, { color: C.accentInk }]}>Apply</Text>}</TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={st.segFull}>
                  <TouchableOpacity style={[st.segFullBtn, kind === "once" && st.segOn]} onPress={() => setKind("once")}><Text style={[st.segText, kind === "once" && st.segTextOn]}>One-time</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.segFullBtn, kind === "recurring" && st.segOn]} onPress={() => setKind("recurring")}><Text style={[st.segText, kind === "recurring" && st.segTextOn]}>Recurring task</Text></TouchableOpacity>
                </View>

                <Text style={st.label}>Title</Text>
                <TextInput style={st.input} value={title} onChangeText={setTitle} placeholder={kind === "once" ? "e.g. Dentist appointment" : "e.g. Read"} placeholderTextColor={C.faint} autoFocus />

                <View style={st.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.label}>Minutes {kind === "recurring" ? "each" : ""}</Text>
                    <TextInput style={st.input} value={minutes} onChangeText={setMinutes} keyboardType="number-pad" />
                  </View>
                  {kind === "recurring" && (
                    <View style={{ flex: 1 }}>
                      <Text style={st.label}>How often</Text>
                      <View style={st.freq}>
                        <TextInput style={[st.input, { width: 48 }]} value={quota} onChangeText={setQuota} keyboardType="number-pad" />
                        <View style={st.seg}>
                          <TouchableOpacity style={[st.segBtn, period === "day" && st.segOn]} onPress={() => setPeriod("day")}><Text style={[st.segText, period === "day" && st.segTextOn]}>/day</Text></TouchableOpacity>
                          <TouchableOpacity style={[st.segBtn, period === "week" && st.segOn]} onPress={() => setPeriod("week")}><Text style={[st.segText, period === "week" && st.segTextOn]}>/wk</Text></TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}
                </View>

                {kind === "recurring" && (
                  <>
                    <TouchableOpacity style={st.checkRow} onPress={() => setFixedTime((v) => !v)}>
                      <View style={[st.checkbox, fixedTime && st.checkboxOn]}>{fixedTime && <Text style={st.checkMark}>✓</Text>}</View>
                      <Text style={st.checkLabel}>At a specific time each time</Text>
                    </TouchableOpacity>
                    {fixedTime && (
                      <>
                        <Text style={st.label}>Time</Text>
                        <View style={st.timeRow}>
                          <TouchableOpacity style={st.chip} onPress={() => setRecPicker((v) => !v)}><Text style={st.chipText}>{atTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></TouchableOpacity>
                        </View>
                        {recPicker && Platform.OS !== "web" && (
                          <View>
                            <DateTimePicker value={atTime} mode="time" onChange={(_, d) => { if (Platform.OS !== "ios") setRecPicker(false); if (d) setAtTime(d); }} themeVariant="dark" />
                            {Platform.OS === "ios" && <TouchableOpacity style={st.pickerDone} onPress={() => setRecPicker(false)}><Text style={st.pickerDoneText}>Done</Text></TouchableOpacity>}
                          </View>
                        )}
                      </>
                    )}
                  </>
                )}

                {kind === "once" && (
                  <>
                    <TouchableOpacity style={st.checkRow} onPress={() => setExactTime((v) => !v)}>
                      <View style={[st.checkbox, exactTime && st.checkboxOn]}>{exactTime && <Text style={st.checkMark}>✓</Text>}</View>
                      <Text style={st.checkLabel}>At a specific time</Text>
                    </TouchableOpacity>
                    <Text style={st.label}>{exactTime ? "When" : "Day (it'll find a slot)"}</Text>
                    <View style={st.timeRow}>
                      <TouchableOpacity style={st.chip} onPress={() => setPicker("date")}><Text style={st.chipText}>{dateStr}</Text></TouchableOpacity>
                      {exactTime && <TouchableOpacity style={st.chip} onPress={() => setPicker("time")}><Text style={st.chipText}>{timeStr}</Text></TouchableOpacity>}
                    </View>
                    {picker && Platform.OS !== "web" && (
                      <View>
                        <DateTimePicker value={when} mode={picker} onChange={onPick} themeVariant="dark" />
                        {Platform.OS === "ios" && <TouchableOpacity style={st.pickerDone} onPress={() => setPicker(null)}><Text style={st.pickerDoneText}>Done</Text></TouchableOpacity>}
                      </View>
                    )}
                  </>
                )}

                {error ? <Text style={st.error}>{error}</Text> : null}
                <View style={st.foot}>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={[st.btn, st.ghost]} disabled={busy} onPress={onClose}><Text style={st.btnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.btn, st.primary, (busy || !title.trim()) && { opacity: 0.5 }]} disabled={busy || !title.trim()} onPress={submit}>{busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={[st.btnText, { color: C.accentInk }]}>Add</Text>}</TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(6,12,14,0.7)", justifyContent: "center", padding: 16 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 14, padding: 18, maxHeight: "90%" },
  headRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  title: { color: C.ink, fontSize: 16, fontWeight: "700" },
  close: { color: C.muted, fontSize: 18, padding: 4 },
  muted: { color: C.muted, fontSize: 13, marginBottom: 8 },
  moveList: { gap: 6, marginBottom: 12 },
  moveItem: { color: C.muted, fontSize: 13 },
  bold: { color: C.ink, fontWeight: "700" },
  segFull: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: 9, padding: 3, gap: 3, marginBottom: 14 },
  segFullBtn: { flex: 1, paddingVertical: 9, borderRadius: 7, alignItems: "center" },
  label: { color: C.muted, fontSize: 12, fontWeight: "500", marginBottom: 5 },
  input: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: C.ink, fontSize: 15, marginBottom: 12 },
  fieldRow: { flexDirection: "row", gap: 12 },
  freq: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: C.line, borderRadius: 7, overflow: "hidden" },
  segBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  segOn: { backgroundColor: C.accent },
  segText: { color: C.muted, fontSize: 12, fontWeight: "500" },
  segTextOn: { color: C.accentInk },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: C.accent, borderColor: C.accent },
  checkMark: { color: C.accentInk, fontSize: 13, fontWeight: "700" },
  checkLabel: { color: C.ink, fontSize: 14 },
  timeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  chipText: { color: C.ink, fontSize: 14, fontVariant: ["tabular-nums"] },
  pickerDone: { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 12 },
  pickerDoneText: { color: C.accent, fontWeight: "600" },
  error: { color: C.err, fontSize: 13, marginBottom: 8 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  btn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.line },
  primary: { backgroundColor: C.accent },
  btnText: { color: C.ink, fontWeight: "600", fontSize: 14 },
});
