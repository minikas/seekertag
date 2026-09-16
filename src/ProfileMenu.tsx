import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Pressable from './HapticPressable';
import { C, Icon, s } from './ui';

export default function ProfileMenu({ name, busy, onAccount, onLogout }: {
  name: string;
  busy: boolean;
  onAccount: () => void;
  onLogout: () => void;
}) {
  const trigger = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const open = anchor !== null;

  useEffect(() => { setAnchor(null); }, [width, height]);
  function toggle() {
    if (open) { setAnchor(null); return; }
    trigger.current?.measureInWindow((left, top, measuredWidth) => {
      setAnchor({ left, bottom: height - top + 8, width: measuredWidth });
    });
  }

  return <>
    <Pressable
      ref={trigger}
      accessibilityRole="button"
      accessibilityLabel={`Menu do perfil: ${name}`}
      accessibilityState={{ expanded: open, disabled: busy }}
      disabled={busy}
      onPress={toggle}
      style={({ pressed }) => [s.row, { marginTop: 24, minHeight: 44, borderRadius: 12, opacity: busy || pressed ? 0.7 : 1 }]}
    >
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.raised, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: C.ink }}>{name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <Text numberOfLines={1} style={[s.label, { flex: 1, fontSize: 12 }]}>{name}</Text>
      <Icon name={open ? 'chevron-down' : 'chevron-up'} size={15} color={C.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setAnchor(null)}>
      <Pressable accessible={false} focusable={false} onPress={() => setAnchor(null)} style={StyleSheet.absoluteFill} />
      {anchor && <View accessibilityRole="menu" accessibilityLabel="Perfil" style={{ position: 'absolute', ...anchor, padding: 6, backgroundColor: C.popover, borderWidth: 1, borderColor: C.line, borderRadius: 12 }}>
        <Pressable accessibilityRole="menuitem" accessibilityLabel="Minha conta" onPress={() => { setAnchor(null); onAccount(); }} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
          <Icon name="user" size={18} color={C.muted} /><Text style={styles.label}>Minha conta</Text>
        </Pressable>
        <Pressable accessibilityRole="menuitem" accessibilityLabel="Sair" disabled={busy} onPress={() => { setAnchor(null); onLogout(); }} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
          <Icon name="log-out" size={18} color={C.muted} /><Text style={styles.label}>Sair</Text>
        </Pressable>
      </View>}
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: 7 },
  pressed: { backgroundColor: C.raised },
  label: { color: C.ink, fontSize: 13 },
});
