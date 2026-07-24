import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { applyInsight, durationInsights, type Insight } from "../lib/data";
import { C } from "../theme";

export function Insights({ reloadKey = 0, onChanged }: { reloadKey?: number; onChanged: () => void }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    durationInsights().then(setInsights).catch(() => setInsights([]));
  }, [reloadKey]);

  const visible = insights.filter((i) => !dismissed.has(i.taskId));
  if (visible.length === 0) return null;

  async function apply(i: Insight) {
    setBusy(true);
    try {
      await applyInsight(i.taskId, i.suggested);
      setDismissed((d) => new Set(d).add(i.taskId));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.wrap}>
      {visible.map((i) => {
        const longer = i.suggested > i.planned;
        return (
          <View key={i.taskId} style={s.card}>
            <Text style={[s.icon, { color: longer ? C.warn : C.ok }]}>{longer ? "↑" : "↓"}</Text>
            <Text style={s.text}>
              <Text style={s.bold}>{i.title}</Text> is averaging <Text style={s.bold}>{i.avgActual}m</Text> across {i.samples} sessions — {longer ? "longer" : "shorter"} than the {i.planned}m planned.
            </Text>
            <TouchableOpacity style={s.btn} disabled={busy} onPress={() => apply(i)}><Text style={s.btnText}>Set {i.suggested}m</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setDismissed((d) => new Set(d).add(i.taskId))}><Text style={s.x}>✕</Text></TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 10, gap: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(60,196,202,0.14)", borderWidth: 1, borderColor: "rgba(60,196,202,0.3)", borderRadius: 8, padding: 10 },
  icon: { fontSize: 16, fontWeight: "700" },
  text: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 18 },
  bold: { fontWeight: "700" },
  btn: { backgroundColor: C.accent, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  btnText: { color: C.accentInk, fontWeight: "700", fontSize: 12 },
  x: { color: C.muted, fontSize: 14, paddingHorizontal: 4 },
});
