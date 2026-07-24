import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import type { PlannedBlock } from "../lib/supabase";
import { WeekAgenda } from "./WeekAgenda";
import { WeekGrid } from "./WeekGrid";
import { DayCalendar } from "./DayCalendar";
import { C } from "../theme";

export function WeekView({ reloadKey, onSelect }: { reloadKey: number; onSelect: (b: PlannedBlock) => void }) {
  const [mode, setMode] = useState<"list" | "calendar">("list");
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.bar}>
        <Text style={s.label}>This week</Text>
        <View style={{ flex: 1 }} />
        <View style={s.toggle}>
          <TouchableOpacity style={[s.tbtn, mode === "list" && s.on]} onPress={() => setMode("list")}>
            <Text style={[s.icon, mode === "list" && s.iconOn]}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tbtn, mode === "calendar" && s.on]} onPress={() => setMode("calendar")}>
            <Text style={[s.icon, mode === "calendar" && s.iconOn]}>📅</Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === "list" ? (
        <WeekAgenda reloadKey={reloadKey} onSelect={onSelect} />
      ) : landscape ? (
        <WeekGrid reloadKey={reloadKey} onSelect={onSelect} />
      ) : (
        <>
          <Text style={s.hint}>Rotate your phone sideways for the full week.</Text>
          <DayCalendar reloadKey={reloadKey} onSelect={onSelect} />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  label: { color: C.ink, fontSize: 15, fontWeight: "600" },
  toggle: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: 8, padding: 3, gap: 2 },
  tbtn: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 6 },
  on: { backgroundColor: C.surface },
  icon: { fontSize: 15, opacity: 0.6 },
  iconOn: { opacity: 1 },
  hint: { color: C.faint, fontSize: 12, textAlign: "center", paddingBottom: 6 },
});
