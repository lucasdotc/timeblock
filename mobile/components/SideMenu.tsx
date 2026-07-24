import { useEffect, useRef } from "react";
import { Animated, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";
import { C } from "../theme";

/** Slide-in left drawer holding account + settings, off the crowded header. */
export function SideMenu({
  visible,
  email,
  onClose,
  onFixedHours,
  onSignOut,
}: {
  visible: boolean;
  email: string;
  onClose: () => void;
  onFixedHours: () => void;
  onSignOut: () => void;
}) {
  const W = Math.min(300, Dimensions.get("window").width * 0.82);
  const x = useRef(new Animated.Value(-W)).current;

  useEffect(() => {
    if (visible) Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    else x.setValue(-W);
  }, [visible, W, x]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop}>
          <TouchableWithoutFeedback>
            <Animated.View style={[s.drawer, { width: W, transform: [{ translateX: x }] }]}>
              <Text style={s.appName}>Timeblock</Text>
              <Text style={s.email} numberOfLines={1}>{email}</Text>
              <View style={s.divider} />
              <TouchableOpacity style={s.item} onPress={onFixedHours}>
                <Text style={s.itemIcon}>◷</Text>
                <Text style={s.itemText}>Fixed hours</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.item} onPress={onSignOut}>
                <Text style={s.itemIcon}>⇥</Text>
                <Text style={s.itemText}>Sign out</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  drawer: { height: "100%", backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.line, paddingTop: 54, paddingHorizontal: 16 },
  appName: { color: C.ink, fontSize: 18, fontWeight: "700" },
  email: { color: C.faint, fontSize: 13, marginTop: 3 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 16 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 9 },
  itemIcon: { color: C.faint, fontSize: 16, width: 20, textAlign: "center" },
  itemText: { color: C.ink, fontSize: 15, fontWeight: "500" },
});
