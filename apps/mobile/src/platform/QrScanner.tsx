import { useThemedStyles } from '../PreferencesProvider';
import { Colors } from '../theme';
import { Button, Field, Icon, Notice, Sheet, useUI } from '../ui';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

type Props = { onScan: (url: string) => void; onClose: () => void };

export function QrScanner({ onScan, onClose }: Props) {
  const { C, s, t, locale } = useUI();
  const styles = useThemedStyles(makeStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [cameraFailed, setCameraFailed] = useState(false);
  const accepted = useRef(false);

  function accept(value: string) {
    if (accepted.current) return;
    const clean = value.trim();
    let parsed: URL;
    try { parsed = new URL(clean); }
    catch { setError('Esse código não contém um link. Use o QR code da etiqueta SeekerTag.'); return; }
    if (!['http:', 'https:', 'seekertag:'].includes(parsed.protocol)) {
      setError('Use o link de uma etiqueta SeekerTag.');
      return;
    }
    accepted.current = true;
    onScan(clean);
  }

  async function allowCamera() {
    setError('');
    try {
      if (!permission?.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      const result = await requestPermission();
      if (!result.granted) setError('Câmera não autorizada. Permita o acesso nas configurações ou cole o link da etiqueta abaixo.');
    } catch {
      setError('Não foi possível acessar a câmera. Você pode colar o link abaixo.');
    }
  }

  return (
    <Sheet title={t("Ler etiqueta")} onClose={onClose}>
      <Text style={s.body}>{t("Aponte a câmera para o QR code. O objeto abrirá aqui, sem precisar de uma conta.")}</Text>
      <View style={styles.cameraBox}>
        {!permission ? <ActivityIndicator color={C.accent} accessibilityLabel={t("Verificando permissão da câmera")} /> : permission.granted && !cameraFailed ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => accept(data)}
              onMountError={() => { setCameraFailed(true); setError(t("A câmera não abriu. Feche outros apps que a estejam usando ou cole o link abaixo.")); }}
            />
            <View pointerEvents="none" style={styles.viewfinder}><View style={styles.cornerTopLeft} /><View style={styles.cornerTopRight} /><View style={styles.cornerBottomLeft} /><View style={styles.cornerBottomRight} /></View>
            <Text style={styles.cameraCaption}>{t("Posicione o QR code dentro da moldura")}</Text>
          </>
        ) : (
          <View style={styles.permission}>
            <View style={s.circle}><Icon name="maximize" size={30} /></View>
            <Text style={[s.h3, { textAlign: 'center' }]}>{cameraFailed ? t("Vamos tentar de outro jeito") : t("Sua câmera lê a etiqueta")}</Text>
            <Text style={[s.small, { textAlign: 'center' }]}>{t("A câmera é usada apenas para ler o QR code. Você também pode colar o link abaixo.")}</Text>
            {!cameraFailed && <Button onPress={() => void allowCamera()}>{permission.canAskAgain ? t("Permitir câmera") : t("Abrir configurações")}</Button>}
          </View>
        )}
      </View>
      {!!error && <Notice error text={error} />}
      <Field label={t("Ou cole o link da etiqueta")} accessibilityLabel={t("Link da etiqueta")} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…/found/…" value={manualUrl} onChangeText={setManualUrl} onSubmitEditing={() => accept(manualUrl)} />
      <Button disabled={!manualUrl.trim()} onPress={() => accept(manualUrl)}>{t("Abrir etiqueta")}</Button>
    </Sheet>
  );
}

const corner = { position: 'absolute' as const, width: 32, height: 32 };
const makeStyles = (C: Colors) => StyleSheet.create({
  cameraBox: { minHeight: 320, borderRadius: 26, overflow: 'hidden', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  viewfinder: { width: 190, height: 190 }, cornerTopLeft: { ...corner, borderColor: C.accent, top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 }, cornerTopRight: { ...corner, borderColor: C.accent, top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 }, cornerBottomLeft: { ...corner, borderColor: C.accent, bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 }, cornerBottomRight: { ...corner, borderColor: C.accent, bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
  cameraCaption: { position: 'absolute', bottom: 12, fontSize: 13, color: C.ink, backgroundColor: C.bg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  permission: { padding: 24, gap: 18, alignItems: 'center' },
});
