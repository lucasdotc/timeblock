import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fetchDay, type PlannedBlock } from "../lib/supabase";
import { listFixedSchedules, type FixedSchedule } from "../lib/data";
import { packColumns } from "../lib/layout";
import { blockColor, C } from "../theme";

const PX = 1; // px per minute -> 1440px tall day
const START_SCROLL = 7 * 60;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function DayCalendar({ reloadKey, onSelect }: { reloadKey: number; onSelect: (b: PlannedBlock) => void }) {
  const [day, setDay] = useState(() => new Date());
  const [blocks, setBlocks] = useState<PlannedBlock[]>([]);
  const [fixed, setFixed] = useState<FixedSchedule[]>([]);
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setBlocks(await fetchDay(day).catch(() => []));
    setFixed((await listFixedSchedules().catch(() => [])).filter((f) => f.showOnCalendar));
  }, [day]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const isToday = sameDay(day, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const shift = (n: number) => {
    const d = new Date(day);
    d.setDate(d.getDate() + n);
    setDay(d);
  };

  return (
    <View style={s.wrap}>
      <View style={s.nav}>
        <TouchableOpacity onPress={() => shift(-1)} style={s.arrow}><Text style={s.arrowText}>‹</Text></TouchableOpacity>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={[s.dayLabel, isToday && { color: C.accent }]}>{day.toLocaleDateString([], { weekday: "long" })}</Text>
          <Text style={s.dateLabel}>{day.toLocaleDateString([], { month: "long", day: "numeric" })}{isToday ? " · today" : ""}</Text>
        </View>
        <TouchableOpacity onPress={() => shift(1)} style={s.arrow}><Text style={s.arrowText}>›</Text></TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        onLayout={() => scrollRef.current?.scrollTo({ y: START_SCROLL * PX - 60, animated: false })}
        contentContainerStyle={{ height: 1440 * PX }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <View key={h} style={[s.hourLine, { top: h * 60 * PX }]}>
            <Text style={s.hourLabel}>{h === 0 ? "" : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`}</Text>
          </View>
        ))}

        {isToday && <View style={[s.nowLine, { top: nowMin * PX }]} />}

        <View style={s.blockLayer} pointerEvents="box-none">
          {fixed
            .filter((f) => f.days.length === 0 || f.days.includes((day.getDay() + 6) % 7))
            .map((f) => (
              <View key={f.id} style={[s.fixedBlock, { top: f.startMin * PX, height: (f.endMin - f.startMin) * PX }]} pointerEvents="none">
                <Text style={s.fixedLabel}>{f.title}</Text>
              </View>
            ))}
          {(() => {
            const lay = packColumns(
              blocks.map((b) => {
                const st = new Date(b.starts_at);
                const startMin = st.getHours() * 60 + st.getMinutes();
                return { id: b.id, startMin, endMin: startMin + (new Date(b.ends_at).getTime() - st.getTime()) / 60000 };
              }),
            );
            return blocks.map((b) => {
            const st = new Date(b.starts_at);
            const en = new Date(b.ends_at);
            const top = (st.getHours() * 60 + st.getMinutes()) * PX;
            const height = Math.max(22, ((en.getTime() - st.getTime()) / 60000) * PX);
            const dim = b.status !== "planned";
            const { col, cols } = lay.get(b.id) ?? { col: 0, cols: 1 };
            const colStyle = cols > 1
              ? { left: `${(col / cols) * 100}%` as const, width: `${(1 / cols) * 100}%` as const, right: undefined, borderWidth: 1, borderColor: C.bg }
              : null;
            return (
              <TouchableOpacity
                key={b.id}
                style={[s.block, { top, height, backgroundColor: blockColor(b.title), opacity: dim ? 0.5 : 1 }, colStyle]}
                onPress={() => onSelect(b)}
              >
                <Text style={s.blockTitle} numberOfLines={height < 34 ? 1 : 2}>{b.pinned ? "📌 " : ""}{b.title}</Text>
                {height >= 34 && <Text style={s.blockTime}>{st.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>}
              </TouchableOpacity>
            );
          });
          })()}
        </View>
      </ScrollView>
    </View>
  );
}

const GUTTER = 44;
const s = StyleSheet.create({
  wrap: { flex: 1 },
  nav: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  arrow: { paddingHorizontal: 16, paddingVertical: 4 },
  arrowText: { color: C.muted, fontSize: 26, lineHeight: 28 },
  dayLabel: { color: C.ink, fontSize: 15, fontWeight: "600" },
  dateLabel: { color: C.faint, fontSize: 12 },
  hourLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: C.line, opacity: 0.5 },
  hourLabel: { position: "absolute", left: 6, top: -7, color: C.faint, fontSize: 11, fontVariant: ["tabular-nums"] },
  nowLine: { position: "absolute", left: GUTTER, right: 0, height: 2, backgroundColor: C.err, zIndex: 5 },
  blockLayer: { position: "absolute", left: GUTTER, right: 6, top: 0, bottom: 0 },
  fixedBlock: { position: "absolute", left: 0, right: 0, backgroundColor: C.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.lineStrong, opacity: 0.8, overflow: "hidden" },
  fixedLabel: { color: C.muted, fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, textTransform: "uppercase", letterSpacing: 0.4 },
  block: { position: "absolute", left: 2, right: 2, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  blockTitle: { color: "#fff", fontWeight: "600", fontSize: 12 },
  blockTime: { color: "#fff", opacity: 0.8, fontSize: 10, marginTop: 1, fontVariant: ["tabular-nums"] },
});
