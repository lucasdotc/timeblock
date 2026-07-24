import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchWeek, weekStart, type PlannedBlock } from "../lib/supabase";
import { listFixedSchedules, type FixedSchedule } from "../lib/data";
import { packColumns } from "../lib/layout";
import { blockColor, C } from "../theme";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PX = 0.9; // px per minute
const GUTTER = 36;
const START_SCROLL = 7 * 60;

export function WeekGrid({ reloadKey, onSelect }: { reloadKey: number; onSelect: (b: PlannedBlock) => void }) {
  const [blocks, setBlocks] = useState<PlannedBlock[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<ScrollView>(null);
  const start = weekStart();

  const load = useCallback(async () => {
    setBlocks(await fetchWeek(start).catch(() => []));
    setFixed((await listFixedSchedules().catch(() => [])).filter((f) => f.showOnCalendar));
  }, [start]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const todayIdx = Math.floor((new Date(now).setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const dayOf = (b: PlannedBlock) => Math.floor((new Date(b.starts_at).setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <View style={{ width: GUTTER }} />
        {DAYS.map((d, i) => {
          const date = new Date(start.getTime() + i * 86_400_000);
          return (
            <View key={d} style={s.dayHead}>
              <Text style={[s.dow, i === todayIdx && { color: C.accent }]}>{d}</Text>
              <Text style={[s.dom, i === todayIdx && s.domToday]}>{date.getDate()}</Text>
            </View>
          );
        })}
      </View>

      <ScrollView ref={scrollRef} onLayout={() => scrollRef.current?.scrollTo({ y: START_SCROLL * PX - 40, animated: false })} contentContainerStyle={{ height: 1440 * PX }}>
        <View style={{ flexDirection: "row", height: 1440 * PX }}>
          <View style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) => (
              <Text key={h} style={[s.hourLabel, { top: h * 60 * PX - 6 }]}>{h === 0 ? "" : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`}</Text>
            ))}
          </View>
          {DAYS.map((_, day) => (
            <View key={day} style={[s.col, day === todayIdx && s.colToday]}>
              {Array.from({ length: 24 }, (_, h) => (
                <View key={h} style={[s.hourLine, { top: h * 60 * PX }]} />
              ))}
              {fixed
                .filter((f) => f.days.length === 0 || f.days.includes(day))
                .map((f) => (
                  <View key={f.id} style={[s.fixedBlock, { top: f.startMin * PX, height: (f.endMin - f.startMin) * PX }]} pointerEvents="none" />
                ))}
              {day === todayIdx && <View style={[s.nowLine, { top: nowMin * PX }]} />}
              {(() => {
                const dayBlocks = blocks.filter((b) => dayOf(b) === day);
                const lay = packColumns(
                  dayBlocks.map((b) => {
                    const st = new Date(b.starts_at);
                    const startMin = st.getHours() * 60 + st.getMinutes();
                    return { id: b.id, startMin, endMin: startMin + (new Date(b.ends_at).getTime() - st.getTime()) / 60000 };
                  }),
                );
                return dayBlocks.map((b) => {
                  const st = new Date(b.starts_at);
                  const en = new Date(b.ends_at);
                  const top = (st.getHours() * 60 + st.getMinutes()) * PX;
                  const height = Math.max(18, ((en.getTime() - st.getTime()) / 60000) * PX);
                  const { col, cols } = lay.get(b.id) ?? { col: 0, cols: 1 };
                  const colStyle = cols > 1
                    ? { left: `${(col / cols) * 100}%` as const, width: `${(1 / cols) * 100}%` as const, right: undefined, borderWidth: 0.5, borderColor: C.bg }
                    : null;
                  return (
                    <TouchableOpacity key={b.id} style={[s.block, { top, height, backgroundColor: blockColor(b.title), opacity: b.status !== "planned" ? 0.5 : 1 }, colStyle]} onPress={() => onSelect(b)}>
                      <Text style={s.blockText} numberOfLines={height < 28 ? 1 : 2}>{b.pinned ? "📌" : ""}{b.title}</Text>
                    </TouchableOpacity>
                  );
                });
              })()}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 4 },
  dayHead: { flex: 1, alignItems: "center", borderLeftWidth: 1, borderLeftColor: C.line },
  dow: { color: C.muted, fontSize: 11, fontWeight: "600" },
  dom: { color: C.faint, fontSize: 12, fontVariant: ["tabular-nums"] },
  domToday: { color: C.accentInk, backgroundColor: C.accent, width: 18, height: 18, borderRadius: 9, textAlign: "center", overflow: "hidden", lineHeight: 18 },
  hourLabel: { position: "absolute", right: 4, color: C.faint, fontSize: 9, fontVariant: ["tabular-nums"] },
  col: { flex: 1, position: "relative", borderLeftWidth: 1, borderLeftColor: C.line },
  colToday: { backgroundColor: "rgba(60,196,202,0.04)" },
  hourLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: C.line, opacity: 0.4 },
  nowLine: { position: "absolute", left: 0, right: 0, height: 1.5, backgroundColor: C.err, zIndex: 5 },
  fixedBlock: { position: "absolute", left: 0, right: 0, backgroundColor: C.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.lineStrong, opacity: 0.7 },
  block: { position: "absolute", left: 1, right: 1, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1, overflow: "hidden" },
  blockText: { color: "#fff", fontSize: 9, fontWeight: "600" },
});
