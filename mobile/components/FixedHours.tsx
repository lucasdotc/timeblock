import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  createFixedSchedule,
  deleteFixedSchedule,
  errMsg,
  listFixedSchedules,
  rescheduleAndSave,
  updateFixedSchedule,
  type FixedSchedule,
} from "../lib/data";
import { C } from "../theme";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
const minToLabel = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const minToDate = (m: number) => { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d; };
const dateToMin = (d: Date) => d.getHours() * 60 + d.getMinutes();
const daysLabel = (days: number[]) => (!days.length ? "Every day" : [...days].sort((a, b) => a - b).map((d) => DAYS[d]).join(" · "));

interface Draft {
  id: string | null;
  title: string;
  days: number[];
  startMin: number;
  endMin: number;
  showOnCalendar: boolean;
}
const emptyDraft = (): Draft => ({ id: null, title: "", days: [], startMin: 540, endMin: 1020, showOnCalendar: true });

export function FixedHours({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<FixedSchedule[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picker, setPicker] = useState<null | "start" | "end">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => listFixedSchedules().then(setItems).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, []);

  const badTime = draft ? draft.endMin <= draft.startMin : false;

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
    const payload = { title: draft.title.trim(), days: draft.days, startMin: draft.startMin, endMin: draft.endMin, showOnCalendar: draft.showOnCalendar };
    await run(async () => {
      if (draft.id) await updateFixedSchedule(draft.id, payload);
      else await createFixedSchedule(payload);
    });
    setDraft(null);
    setPicker(null);
  }

  function confirmDelete(f: FixedSchedule) {
    Alert.alert("Delete?", `Remove "${f.title}" from your fixed hours.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => run(() => deleteFixedSchedule(f.id)) },
    ]);
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.head}>
            <Text style={s.title}>Fixed hours</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={s.close}>Done</Text></TouchableOpacity>
          </View>
          <Text style={s.sub}>Sleep, work, classes — times the scheduler always keeps free. Toggle to show them on the calendar.</Text>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }} keyboardShouldPersistTaps="handled">
            {draft ? (
              <>
                <Text style={s.label}>Name</Text>
                <TextInput style={s.input} value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="e.g. Work, Sleep, Class" placeholderTextColor={C.faint} autoFocus />
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Start</Text>
                    <TouchableOpacity style={s.chip} onPress={() => setPicker(picker === "start" ? null : "start")}><Text style={s.chipText}>{minToLabel(draft.startMin)}</Text></TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>End</Text>
                    <TouchableOpacity style={s.chip} onPress={() => setPicker(picker === "end" ? null : "end")}><Text style={s.chipText}>{minToLabel(draft.endMin)}</Text></TouchableOpacity>
                  </View>
                </View>
                {picker && Platform.OS !== "web" && (
                  <DateTimePicker
                    value={minToDate(picker === "start" ? draft.startMin : draft.endMin)}
                    mode="time"
                    onChange={(_, d) => {
                      if (Platform.OS !== "ios") setPicker(null);
                      if (!d) return;
                      setDraft({ ...draft, [picker === "start" ? "startMin" : "endMin"]: dateToMin(d) });
                    }}
                    themeVariant="dark"
                  />
                )}
                {badTime && <Text style={s.err}>End must be after start.</Text>}
                <Text style={s.label}>Days <Text style={s.faint}>(none = every day)</Text></Text>
                <View style={s.dayToggle}>
                  {DAYS.map((d, i) => (
                    <TouchableOpacity key={d} style={[s.dayBtn, draft.days.includes(i) && s.dayOn]} onPress={() => setDraft({ ...draft, days: draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i] })}>
                      <Text style={[s.dayText, draft.days.includes(i) && s.dayTextOn]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.switchRow}>
                  <Text style={s.switchLabel}>Show on calendar</Text>
                  <Switch value={draft.showOnCalendar} onValueChange={(v) => setDraft({ ...draft, showOnCalendar: v })} trackColor={{ true: C.accent }} />
                </View>
                {error ? <Text style={s.err}>{error}</Text> : null}
                <View style={s.foot}>
                  <TouchableOpacity style={[s.btn, s.ghost]} disabled={busy} onPress={() => { setDraft(null); setPicker(null); }}><Text style={s.btnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.btn, s.primary, (busy || !draft.title.trim() || badTime) && { opacity: 0.5 }]} disabled={busy || !draft.title.trim() || badTime} onPress={saveDraft}>{busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={[s.btnText, { color: C.accentInk }]}>{draft.id ? "Save" : "Add"}</Text>}</TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {items === null ? (
                  <ActivityIndicator color={C.accent} />
                ) : items.length === 0 ? (
                  <Text style={s.faint}>No fixed hours yet. Add work, sleep, or anything the scheduler should plan around.</Text>
                ) : (
                  items.map((f) => (
                    <View key={f.id} style={s.fixedRow}>
                      <TouchableOpacity style={s.fixedMain} onPress={() => setDraft({ id: f.id, title: f.title, days: f.days, startMin: f.startMin, endMin: f.endMin, showOnCalendar: f.showOnCalendar })}>
                        <Text style={s.fixedTitle}>{f.title}</Text>
                        <Text style={s.fixedMeta}>{minToLabel(f.startMin)}–{minToLabel(f.endMin)} · {daysLabel(f.days)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.eye, f.showOnCalendar && s.eyeOn]} disabled={busy} onPress={() => run(() => updateFixedSchedule(f.id, { showOnCalendar: !f.showOnCalendar }))}>
                        <Text style={{ fontSize: 15 }}>{f.showOnCalendar ? "👁" : "◌"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.del} disabled={busy} onPress={() => confirmDelete(f)}><Text style={s.delText}>✕</Text></TouchableOpacity>
                    </View>
                  ))
                )}
                {error ? <Text style={s.err}>{error}</Text> : null}
                <TouchableOpacity style={[s.btn, s.primary, { marginTop: 6 }]} disabled={busy} onPress={() => setDraft(emptyDraft())}><Text style={[s.btnText, { color: C.accentInk }]}>+ Add fixed hours</Text></TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { height: "82%", backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 8 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  title: { color: C.ink, fontSize: 16, fontWeight: "700" },
  close: { color: C.accent, fontSize: 15, fontWeight: "600" },
  sub: { color: C.muted, fontSize: 13, paddingHorizontal: 16, paddingBottom: 4, lineHeight: 18 },
  label: { color: C.muted, fontSize: 12, fontWeight: "500", marginBottom: 5 },
  faint: { color: C.faint, fontSize: 13 },
  input: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: C.ink, fontSize: 15 },
  row: { flexDirection: "row", gap: 12 },
  chip: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center" },
  chipText: { color: C.ink, fontSize: 15, fontVariant: ["tabular-nums"] },
  dayToggle: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayBtn: { borderWidth: 1, borderColor: C.line, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  dayOn: { backgroundColor: C.accent, borderColor: C.accent },
  dayText: { color: C.muted, fontSize: 12, fontWeight: "500" },
  dayTextOn: { color: C.accentInk },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  switchLabel: { color: C.ink, fontSize: 14 },
  err: { color: C.err, fontSize: 13 },
  foot: { flexDirection: "row", gap: 8, marginTop: 6 },
  btn: { flex: 1, borderRadius: 9, paddingVertical: 11, alignItems: "center" },
  ghost: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  primary: { backgroundColor: C.accent },
  btnText: { color: C.ink, fontWeight: "700", fontSize: 14 },
  fixedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fixedMain: { flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  fixedTitle: { color: C.ink, fontSize: 15, fontWeight: "600" },
  fixedMeta: { color: C.muted, fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] },
  eye: { borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  eyeOn: { borderColor: C.accent, backgroundColor: "rgba(60,196,202,0.14)" },
  del: { paddingHorizontal: 8, paddingVertical: 8 },
  delText: { color: C.muted, fontSize: 16 },
});
