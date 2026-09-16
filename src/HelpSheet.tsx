import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, C, Icon, IconName, s } from './ui';

const steps: { icon: IconName; title: string; text: string }[] = [
  { icon: 'tag', title: '1. Adicione seu objeto', text: 'Crie uma etiqueta com QR.' },
  { icon: 'maximize', title: '2. Prenda a etiqueta', text: 'Imprima o QR ou grave uma etiqueta NFC.' },
  { icon: 'message-circle', title: '3. Combine a devolução', text: 'Quem encontrar fala com você pelo app.' },
];

export default function HelpSheet({ onClose }: { onClose: () => void }) {
  const sheet = useRef<BottomSheetModal>(null);
  const mounted = useRef(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const close = useCallback(() => sheet.current?.dismiss(), []);
  useEffect(() => {
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => { mounted.current = false; back.remove(); modal?.dismiss(); };
  }, [close]);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior="close" accessibilityLabel="Fechar ajuda" />, []);
  return <BottomSheetModal ref={sheet} name="how-it-works" enableDynamicSizing enablePanDownToClose topInset={insets.top + 8} maxDynamicContentSize={height - insets.top - 32} backdropComponent={backdrop} backgroundStyle={styles.background} handleIndicatorStyle={styles.handle} onDismiss={() => { if (mounted.current) onClose(); }}>
    <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <View style={s.between}><Text accessibilityRole="header" style={s.h2}>Como funciona</Text><Button variant="ghost" icon="x" label="Fechar ajuda" onPress={close} /></View>
      {steps.map(step => <View key={step.title} style={styles.step}><View style={s.settingsIcon}><Icon name={step.icon} size={20} /></View><View style={{ flex: 1, gap: 6 }}><Text style={s.h3}>{step.title}</Text><Text style={s.body}>{step.text}</Text></View></View>)}
      <Text style={[s.small, { textAlign: 'center' }]}>Seus contatos ficam privados. As etiquetas não têm GPS.</Text>
      <Button onPress={close}>Entendi</Button>
    </BottomSheetScrollView>
  </BottomSheetModal>;
}

const styles = StyleSheet.create({
  background: { backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  handle: { backgroundColor: '#536567', width: 44, height: 5 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 24 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
