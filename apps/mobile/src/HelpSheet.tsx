import { useThemedStyles } from './PreferencesProvider';
import { Colors } from './theme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressable from './HapticPressable';
import { NavigationScope, useNavigationLayer } from './Navigation';
import { Button, Icon, IconName, useUI } from './ui';

const steps: { icon: IconName; title: string; text: string }[] = [
  { icon: 'tag', title: 'Seu objeto ganha uma identidade', text: 'Adicione um nome e crie sua etiqueta com QR.' },
  { icon: 'maximize', title: 'Leve a etiqueta com seu objeto', text: 'Baixe e imprima o QR ou grave uma etiqueta NFC. Prenda no objeto.' },
  { icon: 'message-circle', title: 'Encontrou. Escaneou. Conversou.', text: 'Quem encontrar escaneia a etiqueta e envia uma mensagem. Vocês combinam a devolução pelo chat.' },
];

export default function HelpSheet({ onClose, onDismissForever }: { onClose: () => void; onDismissForever: () => void }) {
  const { C, s, t } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [page, setPage] = useState(0);
  const step = steps[page];
  const sheet = useRef<BottomSheetModal>(null);
  const mounted = useRef(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const close = useCallback(() => sheet.current?.dismiss(), []);
  const layer = useNavigationLayer(close, true);
  useEffect(() => {
    mounted.current = true;
    const modal = sheet.current;
    modal?.present();
    return () => { mounted.current = false; modal?.dismiss(); };
  }, [close]);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior="close" accessibilityLabel={t("Fechar ajuda")} />, [t]);
  return <NavigationScope path={layer.path}><BottomSheetModal stackBehavior="push" ref={sheet} name="how-it-works" enableDynamicSizing enablePanDownToClose topInset={insets.top + 8} maxDynamicContentSize={height - insets.top - 32} backdropComponent={backdrop} backgroundStyle={styles.background} handleIndicatorStyle={styles.handle} onDismiss={() => { if (mounted.current) onClose(); }}>
    <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text accessibilityRole="header" style={[s.h2, { flex: 1 }]}>{t("Como funciona")}</Text><Button variant="ghost" icon="x" label={t("Fechar ajuda")} onPress={close} /></View>
      <View style={{ flexDirection: 'row', gap: 8 }}>{steps.map((item, index) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={t('Etapa {number}', { number: index + 1 })} accessibilityState={{ selected: page === index }} onPress={() => setPage(index)} style={{ flex: 1, paddingVertical: 10 }}><View style={{ height: 4, borderRadius: 2, backgroundColor: index <= page ? C.accent : C.line }} /></Pressable>)}</View>
      <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 180, padding: 24, gap: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32 }}>
          <Icon name={page === 0 ? 'briefcase' : page === 1 ? 'smartphone' : 'user'} size={40} color={C.muted} />
          <Icon name="arrow-right" size={20} color={C.accent} />
          <Icon name={step.icon} size={52} color={C.accent} />
        </View>
      </View>
      <View accessibilityLiveRegion="polite" style={{ gap: 12 }}><Text style={[s.h2, { textAlign: 'center' }]}>{t(step.title)}</Text><Text style={[s.body, { textAlign: 'center', color: C.muted }]}>{t(step.text)}</Text></View>
      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 8 }}>{page > 0 && <Button variant="secondary" icon="arrow-left" label={t('Voltar')} onPress={() => setPage(page - 1)} />}<Button style={{ flex: 1 }} onPress={() => page === steps.length - 1 ? close() : setPage(page + 1)}>{t(page === steps.length - 1 ? 'Entendi' : 'Continuar')}</Button></View>
      <Button variant="ghost" onPress={onDismissForever}>{t("Não mostrar novamente")}</Button>
    </BottomSheetScrollView>
  </BottomSheetModal></NavigationScope>;
}

const makeStyles = (C: Colors) => StyleSheet.create({
  background: { backgroundColor: C.popover, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  handle: { backgroundColor: '#536567', width: 44, height: 5 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 32 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
