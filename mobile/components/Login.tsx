import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../lib/supabase";
import { C } from "../theme";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <Text style={s.brand}>Timeblock</Text>
        <Text style={s.sub}>Sign in to plan your week.</Text>

        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={C.faint}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <Text style={s.label}>Password</Text>
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={C.faint}
          secureTextEntry
        />

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={s.btnText}>Sign in</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: 20 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 24, gap: 10 },
  brand: { color: C.ink, fontSize: 26, fontWeight: "700" },
  sub: { color: C.muted, fontSize: 14, marginBottom: 8 },
  label: { color: C.muted, fontSize: 12, fontWeight: "500" },
  input: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: C.ink, fontSize: 15 },
  error: { color: C.err, fontSize: 13 },
  btn: { backgroundColor: C.accent, borderRadius: 9, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  btnText: { color: C.accentInk, fontWeight: "700", fontSize: 15 },
});
