import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { PlannedBlock } from "../lib/supabase";
import { supabase } from "../lib/supabase";
import { TodayList } from "./TodayList";
import { WeekView } from "./WeekView";
import { Insights } from "./Insights";
import { BlockDetail } from "./BlockDetail";
import { ChatPanel } from "./ChatPanel";
import { AddForm } from "./AddForm";
import { FixedHours } from "./FixedHours";
import { SideMenu } from "./SideMenu";
import { syncBlockReminders } from "../lib/notifications";
import { C } from "../theme";

export function Home({ email }: { email: string }) {
  const [tab, setTab] = useState<"today" | "week">("today");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<PlannedBlock | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fixedOpen, setFixedOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const bump = () => setReloadKey((k) => k + 1);

  // Re-schedule local reminders on load and whenever the plan changes.
  useEffect(() => {
    syncBlockReminders();
  }, [reloadKey]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.brand}>Timeblock</Text>
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === "today" && s.tabOn]} onPress={() => setTab("today")}><Text style={[s.tabText, tab === "today" && s.tabTextOn]}>Today</Text></TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === "week" && s.tabOn]} onPress={() => setTab("week")}><Text style={[s.tabText, tab === "week" && s.tabTextOn]}>Week</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.addBtn} onPress={() => setAdding(true)} accessibilityLabel="Add"><Text style={s.addBtnText}>+</Text></TouchableOpacity>
        <TouchableOpacity style={s.menuBtn} onPress={() => setMenuOpen(true)} accessibilityLabel="Menu"><Text style={s.menuIcon}>☰</Text></TouchableOpacity>
      </View>

      <Insights reloadKey={reloadKey} onChanged={bump} />

      <View style={{ flex: 1 }}>
        {tab === "today" ? (
          <TodayList reloadKey={reloadKey} onSelect={setSelected} onChanged={bump} />
        ) : (
          <WeekView reloadKey={reloadKey} onSelect={setSelected} />
        )}
      </View>

      <TouchableOpacity style={s.chatBar} onPress={() => setChatOpen(true)} activeOpacity={0.8}>
        <Text style={s.chatBarText}>Schedule, edit, or remove something…</Text>
        <Text style={s.chatBarIcon}>💬</Text>
      </TouchableOpacity>

      {selected && <BlockDetail block={selected} onClose={() => setSelected(null)} onChanged={bump} />}
      {adding && <AddForm onClose={() => setAdding(false)} onChanged={bump} />}
      {fixedOpen && <FixedHours onClose={() => setFixedOpen(false)} onChanged={bump} />}
      <SideMenu
        visible={menuOpen}
        email={email}
        onClose={() => setMenuOpen(false)}
        onFixedHours={() => { setMenuOpen(false); setFixedOpen(true); }}
        onSignOut={() => { setMenuOpen(false); supabase.auth.signOut(); }}
      />
      <ChatPanel visible={chatOpen} onClose={() => setChatOpen(false)} onChanged={bump} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  brand: { color: C.ink, fontSize: 18, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 2, backgroundColor: C.surface2, borderRadius: 8, padding: 3 },
  tab: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  tabOn: { backgroundColor: C.surface },
  tabText: { color: C.muted, fontSize: 13, fontWeight: "500" },
  tabTextOn: { color: C.ink },
  addBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  addBtnText: { color: C.ink, fontSize: 20, fontWeight: "600", lineHeight: 22 },
  menuBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  menuIcon: { color: C.muted, fontSize: 18 },
  chatBar: { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 11 },
  chatBarText: { flex: 1, color: C.faint, fontSize: 14 },
  chatBarIcon: { fontSize: 16 },
});
