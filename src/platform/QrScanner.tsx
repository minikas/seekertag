import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

type Props = { onScan: (url: string) => void; onClose: () => void };

export function QrScanner({ onScan, onClose }: Props) {
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
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      setError('Use o QR code da etiqueta SeekerTag, com um link HTTP ou HTTPS.');
      return;
    }
    accepted.current = true;
    onScan(clean);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.heading}><Text style={styles.eyebrow}>REENCONTRE O CAMINHO</Text><Text style={styles.title}>Ler etiqueta</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar leitor" onPress={onClose} style={styles.close}><Text style={styles.closeText}>✕</Text></Pressable>
      </View>
      <Text style={styles.description}>Aponte a câmera para o QR code. A página do objeto abrirá aqui, sem precisar de uma conta.</Text>
      <View style={styles.cameraBox}>
        {!permission ? <ActivityIndicator color="#C1B3F6" accessibilityLabel="Verificando permissão da câmera" /> : permission.granted && !cameraFailed ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => accept(data)}
              onMountError={() => { setCameraFailed(true); setError('A câmera não abriu. Feche outros apps que a estejam usando ou cole o link abaixo.'); }}
            />
            <View pointerEvents="none" style={styles.viewfinder}><View style={styles.cornerTopLeft} /><View style={styles.cornerTopRight} /><View style={styles.cornerBottomLeft} /><View style={styles.cornerBottomRight} /></View>
            <Text style={styles.cameraCaption}>Posicione o QR code dentro da moldura</Text>
          </>
        ) : (
          <View style={styles.permission}>
            <Text style={styles.cameraIcon}>⌗</Text>
            <Text style={styles.permissionTitle}>{cameraFailed ? 'Vamos tentar de outro jeito' : 'Sua câmera lê a etiqueta'}</Text>
            <Text style={styles.permissionDescription}>A câmera é usada apenas para ler o QR code. Você também pode colar o link abaixo.</Text>
            {!cameraFailed && <Pressable accessibilityRole="button" style={styles.permissionButton} onPress={() => {
              if (!permission.canAskAgain) { void Linking.openSettings().catch(() => setError('Ative a câmera nas permissões deste app ou navegador.')); }
              else { void requestPermission().catch(() => setError('Não foi possível acessar a câmera. Você pode colar o link abaixo.')); }
            }}><Text style={styles.permissionButtonText}>{permission.canAskAgain ? 'Permitir câmera' : 'Abrir configurações'}</Text></Pressable>}
          </View>
        )}
      </View>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Text style={styles.label}>Ou cole o link da etiqueta</Text>
      <TextInput accessibilityLabel="Link da etiqueta" autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…/found/sua-etiqueta" placeholderTextColor="#8F8A96" value={manualUrl} onChangeText={setManualUrl} onSubmitEditing={() => accept(manualUrl)} style={styles.input} />
      <Pressable accessibilityRole="button" disabled={!manualUrl.trim()} onPress={() => accept(manualUrl)} style={[styles.button, !manualUrl.trim() && styles.disabled]}><Text style={styles.buttonText}>Abrir etiqueta</Text></Pressable>
    </View>
  );
}

const corner = { position: 'absolute' as const, width: 32, height: 32, borderColor: '#D8C9FF' };
const styles = StyleSheet.create({
  container: { padding: 24, gap: 16, backgroundColor: '#FAF8F5', borderRadius: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { flex: 1, gap: 7 }, eyebrow: { fontSize: 10, letterSpacing: 1.8, color: '#756A90', fontWeight: '700' }, title: { fontSize: 28, fontWeight: '700', color: '#25212C' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEEBE7' }, closeText: { fontSize: 21, color: '#393340' },
  description: { color: '#716B78', fontSize: 15, lineHeight: 23 }, cameraBox: { height: 280, borderRadius: 20, overflow: 'hidden', backgroundColor: '#29232F', alignItems: 'center', justifyContent: 'center' },
  viewfinder: { width: 190, height: 190 }, cornerTopLeft: { ...corner, top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 }, cornerTopRight: { ...corner, top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 }, cornerBottomLeft: { ...corner, bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 }, cornerBottomRight: { ...corner, bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
  cameraCaption: { position: 'absolute', bottom: 12, fontSize: 11, color: '#FFFFFF', backgroundColor: '#29232F', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  permission: { padding: 24, gap: 10, alignItems: 'center' }, cameraIcon: { color: '#D6C5FF', fontSize: 34 }, permissionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', textAlign: 'center' }, permissionDescription: { color: '#D9D3E2', fontSize: 13, lineHeight: 19, textAlign: 'center' }, permissionButton: { backgroundColor: '#D6C5FF', minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12, marginTop: 4 }, permissionButtonText: { color: '#39295B', fontWeight: '700', fontSize: 14 },
  error: { color: '#A3403D', fontSize: 13, lineHeight: 20 }, label: { fontSize: 13, fontWeight: '600', color: '#4C4458' }, input: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2DDD9', minHeight: 50, paddingHorizontal: 14, borderRadius: 12, fontSize: 15, color: '#29232F' }, button: { backgroundColor: '#7050B0', minHeight: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12 }, buttonText: { fontSize: 15, color: '#FFFFFF', fontWeight: '700' }, disabled: { opacity: 0.45 },
});
