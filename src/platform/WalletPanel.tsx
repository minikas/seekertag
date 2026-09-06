import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { connectWallet, disconnectWallet } from './wallet';
import { WalletConnection } from './wallet.types';

export function WalletPanel() {
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (connection) { await disconnectWallet(); setConnection(null); }
      else { setConnection(await connectWallet()); }
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível acessar a carteira.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.card}>
    <View style={styles.row}><View style={styles.icon}><Text style={styles.iconText}>◎</Text></View><View style={styles.heading}><Text style={styles.title}>Sua carteira Solana</Text><Text style={styles.subtitle}>Uma conexão opcional</Text></View></View>
    <Text style={styles.body}>{connection ? 'Carteira conectada neste dispositivo. Essa conexão não comprova a propriedade de objetos e não altera sua conta SeekerTag.' : 'Use sua carteira no Android ou no navegador compatível. Suas etiquetas e conversas funcionam sem ela.'}</Text>
    {connection && <View style={styles.addressBox}><Text style={styles.walletName}>{connection.label}</Text><Text selectable style={styles.address}>{connection.address}</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggle()} style={[styles.button, busy && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color="#624795" /> : <Text style={styles.buttonText}>{connection ? 'Desconectar carteira' : 'Conectar carteira'}</Text>}</Pressable>
    <Text style={styles.note}>Nenhuma transferência é solicitada. As chaves continuam na sua carteira.</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FAF8F5', borderWidth: 1, borderColor: '#E9E3EF', padding: 22, borderRadius: 20, gap: 15 }, row: { flexDirection: 'row', gap: 12, alignItems: 'center' }, icon: { width: 46, height: 46, backgroundColor: '#EBE3F7', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, iconText: { fontSize: 30, color: '#7954AF' }, heading: { flex: 1, gap: 5 }, title: { color: '#332A40', fontSize: 18, fontWeight: '700' }, subtitle: { color: '#84758F', fontSize: 12 }, body: { color: '#766B7E', fontSize: 14, lineHeight: 21 }, button: { minHeight: 48, borderWidth: 1, borderColor: '#D9C9EB', backgroundColor: '#F2ECFA', justifyContent: 'center', alignItems: 'center', borderRadius: 12 }, buttonText: { color: '#624795', fontSize: 14, fontWeight: '700' }, note: { fontSize: 11, color: '#83798B', lineHeight: 17 }, error: { fontSize: 13, color: '#A34442', lineHeight: 20 }, addressBox: { padding: 14, backgroundColor: '#F0EBF4', borderRadius: 12, gap: 6 }, walletName: { fontSize: 12, color: '#6B5584', fontWeight: '700' }, address: { color: '#574667', fontSize: 12, lineHeight: 18 },
});
