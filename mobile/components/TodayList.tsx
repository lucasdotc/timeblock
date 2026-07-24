import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchDay, type PlannedBlock } from "../lib/supabase";
import { markDoneWithActual, setBlockStatus } from "../lib/data";
import { C } from "../theme";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();

export function TodayList({ reloadKey, onSelect, onChanged }: { reloadKey: number; onSelect: (b: PlannedBlock) => void; onChanged: () => void }) {
  const [blocks, setBlocks] = useState<PlannedBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setBlocks(await fetchDay());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  async function toggle(b: PlannedBlock, next: "done" | "skipped") {
    const status = b.status === next ? "planned" : next;
    setBlocks((cur) => cur.map((x) => (x.id === b.id ? { ...x, status } : x)));
    if (status === "done") {
      const min = Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000);
      await markDoneWithActual(b.id, min);
    } else {
      await setBlockStatus(b.id, status);
    }
    onChanged();
  }

  const now = Date.now();
  const done = blocks.filter((b) => b.status === "done").length;
  const todayLabel = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <FlatList
      data={blocks}
      keyExtractor={(b) => b.id}
      contentContainerStyle={{ padding: 14, paddingBottom: 24, gap: 8 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.muted} />}
      ListHeaderComponent={
        <View style={s.head}>
          <Text style={s.sub}>{todayLabel}</Text>
          <Text style={s.sub}>{done}/{blocks.length} done</Text>
        </View>
      }
      ListEmptyComponent={!loading ? <Text style={s.empty}>Nothing scheduled today. Add something below.</Text> : null}
      renderItem={({ item: b }) => {
        const missed = b.status === "planned" && new Date(b.ends_at).getTime() < now;
        const doneS = b.status === "done";
        return (
          <View style={[s.row, doneS && s.dim, b.status === "skipped" && s.dim, missed && s.missedRow]}>
            <TouchableOpacity style={[s.check, doneS && s.checkOn]} onPress={() => toggle(b, "done")}>
              {doneS ? <Text style={s.checkMark}>✓</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={s.main} onPress={() => onSelect(b)}>
              <Text style={s.time}>{time(b.starts_at)}</Text>
              <Text style={[s.title, (doneS || b.status === "skipped") && s.struck]} numberOfLines={1}>{b.title}</Text>
              {missed ? <Text style={s.missed}>missed</Text> : null}
              {b.note ? <Text style={s.noteDot}>•</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggle(b, "skipped")}><Text style={s.skip}>{b.status === "skipped" ? "skipped" : "skip"}</Text></TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 6 },
  sub: { color: C.faint, fontSize: 12 },
  empty: { color: C.faint, textAlign: "center", padding: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingVertical: 8, paddingLeft: 8, paddingRight: 12 },
  dim: { opacity: 0.55 },
  missedRow: { borderColor: "#5a4a2a" },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, borderColor: C.lineStrong, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.ok, borderColor: C.ok },
  checkMark: { color: C.accentInk, fontWeight: "700", fontSize: 15 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  time: { color: C.muted, fontSize: 13, width: 58, fontVariant: ["tabular-nums"] },
  title: { color: C.ink, fontSize: 15, flexShrink: 1 },
  struck: { textDecorationLine: "line-through" },
  missed: { color: C.warn, fontSize: 11 },
  noteDot: { color: C.accent, fontSize: 16 },
  skip: { color: C.faint, fontSize: 12 },
});
