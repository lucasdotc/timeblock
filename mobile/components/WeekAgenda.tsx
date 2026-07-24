import { useCallback, useEffect, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchWeek, weekStart, type PlannedBlock } from "../lib/supabase";
import { blockColor, C } from "../theme";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();

interface Section {
  title: string;
  isToday: boolean;
  data: PlannedBlock[];
}

export function WeekAgenda({ reloadKey, onSelect }: { reloadKey: number; onSelect: (b: PlannedBlock) => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const blocks = await fetchWeek();
      const start = weekStart();
      const todayIdx = Math.floor((new Date().setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);
      const byDay = new Map<number, PlannedBlock[]>();
      for (const b of blocks) {
        const d = Math.floor((new Date(b.starts_at).setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);
        (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(b);
      }
      const secs: Section[] = [];
      for (let d = 0; d < 7; d++) {
        const items = byDay.get(d);
        if (!items || items.length === 0) continue;
        const date = new Date(start.getTime() + d * 86_400_000);
        secs.push({
          title: date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }),
          isToday: d === todayIdx,
          data: items,
        });
      }
      setSections(secs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(b) => b.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.muted} />}
      ListEmptyComponent={!loading ? <Text style={s.empty}>No blocks this week. Add something below.</Text> : null}
      renderSectionHeader={({ section }) => (
        <Text style={[s.dayHead, (section as Section).isToday && s.today]}>
          {section.title}{(section as Section).isToday ? "  · today" : ""}
        </Text>
      )}
      renderItem={({ item: b }) => {
        const doneS = b.status === "done";
        return (
          <TouchableOpacity style={[s.row, (doneS || b.status === "skipped") && s.dim]} onPress={() => onSelect(b)}>
            <Text style={s.time}>{time(b.starts_at)}</Text>
            <View style={[s.dot, { backgroundColor: blockColor(b.title) }]} />
            <Text style={[s.title, (doneS || b.status === "skipped") && s.struck]} numberOfLines={1}>{b.title}</Text>
            {doneS ? <Text style={s.check}>✓</Text> : null}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  empty: { color: C.faint, textAlign: "center", padding: 32 },
  dayHead: { color: C.muted, fontSize: 13, fontWeight: "600", marginTop: 16, marginBottom: 6 },
  today: { color: C.accent },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  dim: { opacity: 0.5 },
  time: { color: C.muted, fontSize: 13, width: 58, fontVariant: ["tabular-nums"] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: C.ink, fontSize: 15, flex: 1 },
  struck: { textDecorationLine: "line-through" },
  check: { color: C.ok, fontSize: 14 },
});
