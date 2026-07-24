import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import type { PlannedBlock } from "../lib/supabase";
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
} from "../lib/data";
import { C } from "../theme";

const localISO = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function BlockDetail({ block, onClose, onChanged }: { block: PlannedBlock; onClose: () => void; onChanged: () => void }) {
  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s0 = new Date(block.starts_at);
  const e0 = new Date(block.ends_at);
  const plannedMin = Math.round((e0.getTime() - s0.getTime()) / 60_000);

  const [title, setTitle] = useState(block.title);
  const [startDate, setStartDate] = useState(new Date(block.starts_at));
  const [endDate, setEndDate] = useState(new Date(block.ends_at));
  const [picker, setPicker] = useState<null | { which: "start" | "end"; mode: "date" | "time" }>(null);
  const [quota, setQuota] = useState("");
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState(block.note ?? "");
  const [actual, setActual] = useState(String(plannedMin));
  const [suggestion, setSuggestion] = useState<Suggestion | null | "none">(null);
  const [overlap, setOverlap] = useState<OverlapHit[] | null>(null);
  const [overlapStep, setOverlapStep] = useState<1 | 2>(1);

  const done = block.status === "done";
  // Duration is derived from start/end (no direct minutes entry).
  const durationMin = Math.max(5, Math.round((endDate.getTime() - startDate.getTime()) / 60_000));
  const timeChanged = startDate.getTime() !== s0.getTime() || endDate.getTime() !== e0.getTime();
  const badTime = endDate.getTime() <= startDate.getTime();

  useEffect(() => {
    if (!block.task_id) return setLoading(false);
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

  async function commitSave() {
    if (timeChanged) await updateBlockTime(block.id, localISO(startDate), durationMin);
    if (task) {
      const q = Math.max(1, Number(quota) || task.quota);
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
        const hits = await overlappingBlocks(localISO(startDate), durationMin, block.id);
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
      if (mode === "keep") await keepOverlapped(block.id, localISO(startDate), durationMin, overlap);
      else await moveToAccommodate(block.id, localISO(startDate), durationMin, overlap);
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

  function onPick(_: unknown, d?: Date) {
    if (Platform.OS !== "ios") setPicker(null);
    if (!d || !picker) return;
    if (picker.which === "start") {
      const next = new Date(startDate);
      if (picker.mode === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
      // Moving the start drags the end to keep the length.
      const delta = next.getTime() - startDate.getTime();
      setStartDate(next);
      setEndDate(new Date(endDate.getTime() + delta));
    } else {
      const next = new Date(endDate);
      if (picker.mode === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
      setEndDate(next);
    }
  }

  function confirmDelete() {
    if (task) {
      Alert.alert("Delete task?", `Remove "${task.title}" and all its blocks.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => run(async () => { await deleteTask(task.id); await rescheduleAndSave(); }) },
      ]);
    } else {
      Alert.alert("Delete?", `Remove "${block.title}".`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => run(() => deleteBlock(block.id)) },
      ]);
    }
  }

  const fmtDate = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={st.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={st.headRow}>
              <TextInput style={st.titleInput} value={title} onChangeText={setTitle} placeholder={block.title} placeholderTextColor={C.faint} />
              <TouchableOpacity onPress={onClose}><Text style={st.close}>✕</Text></TouchableOpacity>
            </View>
            <View style={st.badges}>
              <Text style={[st.badge, done && st.badgeDone]}>{block.status}</Text>
              {block.pinned && <Text style={[st.badge, st.badgePinned]}>📌 pinned</Text>}
            </View>

            {overlap ? (
              <View style={st.overlapPrompt}>
                {overlapStep === 1 ? (
                  <>
                    <Text style={st.overlapText}>
                      Changing <Text style={st.bold}>{title}</Text> to{" "}
                      <Text style={st.bold}>{startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>{" "}
                      overlaps with <Text style={st.bold}>{overlap.map((o) => o.title).join(", ")}</Text>. Would you like to continue?
                    </Text>
                    <View style={st.actions}>
                      <TouchableOpacity style={[st.abtn, st.aghost]} disabled={busy} onPress={() => { setOverlap(null); onClose(); }}><Text style={st.abtnText}>Cancel</Text></TouchableOpacity>
                      <TouchableOpacity style={[st.abtn, st.saveBtn]} disabled={busy} onPress={() => setOverlapStep(2)}><Text style={[st.abtnText, { color: C.accentInk }]}>Yes, continue</Text></TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={st.overlapText}>How should they fit together?</Text>
                    <TouchableOpacity style={[st.stackBtn, st.saveBtn]} disabled={busy} onPress={() => resolveOverlap("move")}><Text style={[st.abtnText, { color: C.accentInk }]}>Move {overlap.map((o) => o.title).join(", ")} to accommodate</Text></TouchableOpacity>
                    <TouchableOpacity style={[st.stackBtn, st.aghost]} disabled={busy} onPress={() => resolveOverlap("keep")}><Text style={st.abtnText}>Keep them overlapped</Text></TouchableOpacity>
                    {error ? <Text style={st.error}>{error}</Text> : null}
                  </>
                )}
              </View>
            ) : loading ? (
              <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} />
            ) : (
              <>
                <View style={st.actions}>
                  <TouchableOpacity style={[st.abtn, done ? st.abtnOn : st.aghost]} disabled={busy} onPress={() => run(() => (done ? setBlockStatus(block.id, "planned") : markDoneWithActual(block.id, Number(actual) || plannedMin)))}>
                    <Text style={[st.abtnText, done && { color: C.accentInk }]}>{done ? "✓ Done" : "Mark done"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.abtn, st.aghost]} disabled={busy} onPress={() => run(() => setBlockStatus(block.id, "skipped"))}><Text style={st.abtnText}>Skip</Text></TouchableOpacity>
                  {task && <TouchableOpacity style={[st.abtn, st.aghost]} disabled={busy} onPress={reschedule}><Text style={st.abtnText}>Reschedule</Text></TouchableOpacity>}
                </View>

                {suggestion === "none" && <Text style={st.hint}>No free slot fits this week.</Text>}
                {suggestion && suggestion !== "none" && (
                  <View style={st.suggestion}>
                    <Text style={{ color: C.ink, flex: 1 }}>Move to {suggestion.label}?</Text>
                    <TouchableOpacity style={st.moveBtn} disabled={busy} onPress={() => run(() => applyReschedule(block.id, suggestion))}><Text style={st.moveBtnText}>Move</Text></TouchableOpacity>
                  </View>
                )}

                <Text style={st.label}>Start</Text>
                <View style={st.timeRow}>
                  <TouchableOpacity style={st.chip} onPress={() => setPicker({ which: "start", mode: "date" })}><Text style={st.chipText}>{fmtDate(startDate)}</Text></TouchableOpacity>
                  <TouchableOpacity style={st.chip} onPress={() => setPicker({ which: "start", mode: "time" })}><Text style={st.chipText}>{fmtTime(startDate)}</Text></TouchableOpacity>
                </View>
                <Text style={st.label}>End</Text>
                <View style={st.timeRow}>
                  <TouchableOpacity style={st.chip} onPress={() => setPicker({ which: "end", mode: "date" })}><Text style={st.chipText}>{fmtDate(endDate)}</Text></TouchableOpacity>
                  <TouchableOpacity style={st.chip} onPress={() => setPicker({ which: "end", mode: "time" })}><Text style={st.chipText}>{fmtTime(endDate)}</Text></TouchableOpacity>
                </View>
                <Text style={[st.label, badTime && { color: C.err }]}>{badTime ? "End must be after start." : `${durationMin} min`}</Text>
                {picker && Platform.OS !== "web" && (
                  <View>
                    <DateTimePicker value={picker.which === "start" ? startDate : endDate} mode={picker.mode} onChange={onPick} themeVariant="dark" />
                    {Platform.OS === "ios" && <TouchableOpacity style={st.done} onPress={() => setPicker(null)}><Text style={st.doneText}>Done</Text></TouchableOpacity>}
                  </View>
                )}

                {task && (
                  <View style={st.field}>
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

                {task && (
                  <View style={st.field}>
                    <Text style={st.label}>Description</Text>
                    <TextInput style={[st.input, st.multiline]} value={description} onChangeText={setDescription} placeholder="What this task is about…" placeholderTextColor={C.faint} multiline />
                  </View>
                )}

                {!done && (
                  <View style={st.field}>
                    <Text style={st.label}>How long did it take? (helps the app learn your pace)</Text>
                    <View style={st.actualRow}>
                      <TextInput style={[st.input, { width: 90 }]} value={actual} onChangeText={setActual} keyboardType="number-pad" />
                      <Text style={st.unit}>min</Text>
                    </View>
                  </View>
                )}

                <View style={st.field}>
                  <Text style={st.label}>Note for this occurrence</Text>
                  <TextInput style={[st.input, st.multiline]} value={note} onChangeText={setNote} placeholder="e.g. focus on graph problems" placeholderTextColor={C.faint} multiline />
                </View>

                {error ? <Text style={st.error}>{error}</Text> : null}

                <View style={st.foot}>
                  <TouchableOpacity disabled={busy} onPress={confirmDelete}><Text style={st.delete}>{task ? "Delete task" : "Delete"}</Text></TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={[st.abtn, st.aghost]} disabled={busy} onPress={onClose}><Text style={st.abtnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[st.abtn, st.saveBtn, badTime && { opacity: 0.5 }]} disabled={busy || badTime} onPress={save}>{busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={[st.abtnText, { color: C.accentInk }]}>Save</Text>}</TouchableOpacity>
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
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleInput: { flex: 1, color: C.ink, fontSize: 17, fontWeight: "600", paddingVertical: 4 },
  close: { color: C.muted, fontSize: 18, padding: 4 },
  badges: { flexDirection: "row", gap: 8, marginTop: 2, marginBottom: 14 },
  badge: { color: C.muted, fontSize: 11, textTransform: "capitalize", borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: "hidden" },
  badgeDone: { color: C.ok, borderColor: C.ok },
  badgePinned: { color: C.accent, borderColor: C.accent, textTransform: "none" },
  actions: { flexDirection: "row", gap: 8, marginBottom: 12 },
  abtn: { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  aghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.line },
  abtnOn: { backgroundColor: C.ok },
  abtnText: { color: C.ink, fontWeight: "600", fontSize: 13 },
  saveBtn: { backgroundColor: C.accent, flex: 0, paddingHorizontal: 18 },
  hint: { color: C.warn, fontSize: 13, marginBottom: 10 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(60,196,202,0.14)", borderWidth: 1, borderColor: "rgba(60,196,202,0.3)", borderRadius: 8, padding: 10, marginBottom: 12 },
  moveBtn: { backgroundColor: C.accent, borderRadius: 7, paddingHorizontal: 14, paddingVertical: 7 },
  moveBtnText: { color: C.accentInk, fontWeight: "700", fontSize: 13 },
  timeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  chipText: { color: C.ink, fontSize: 14, fontVariant: ["tabular-nums"] },
  done: { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 12 },
  doneText: { color: C.accent, fontWeight: "600" },
  field: { marginBottom: 12 },
  fieldRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  label: { color: C.muted, fontSize: 12, fontWeight: "500", marginBottom: 5 },
  input: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: C.ink, fontSize: 15 },
  multiline: { minHeight: 48, textAlignVertical: "top" },
  freq: { flexDirection: "row", alignItems: "center", gap: 8 },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: C.line, borderRadius: 7, overflow: "hidden" },
  segBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  segOn: { backgroundColor: C.accent },
  segText: { color: C.muted, fontSize: 12, fontWeight: "500" },
  segTextOn: { color: C.accentInk },
  actualRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  unit: { color: C.faint, fontSize: 14 },
  error: { color: C.err, fontSize: 13, marginBottom: 8 },
  overlapPrompt: { gap: 12, paddingVertical: 8 },
  overlapText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  bold: { fontWeight: "700" },
  stackBtn: { borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  delete: { color: C.err, fontSize: 13, fontWeight: "600", paddingVertical: 8 },
});
