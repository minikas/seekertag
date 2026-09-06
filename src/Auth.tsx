import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { api, User } from './api';
import { Brand, Button, C, Field, Icon, Notice, s } from './ui';

export default function Auth({ onAuth, onScan }: { onAuth: (token: string, user: User, recoveryCode?: string) => Promise<void>; onScan: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 850;
  const [mode, setMode] = useState<'register' | 'login' | 'recover'>('register');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!email.trim() || !password || (mode === 'register' && !name.trim())) { setError('Preencha os campos para continuar.'); return; }
    if (mode !== 'login' && password.length < 10) { setError('Escolha uma senha com pelo menos 10 caracteres.'); return; }
    setBusy(true); setError('');
    try { const result = await api<{ token: string; user: User; recoveryCode?: string }>(`/auth/${mode}`, null, { email: email.trim(), password, ...(mode === 'register' ? { name: name.trim() } : {}), ...(mode === 'recover' ? { recoveryCode: code.trim() } : {}) }); await onAuth(result.token, result.user, result.recoveryCode); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: C.bg }} keyboardShouldPersistTaps="handled"><View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', minHeight: wide ? 760 : undefined }}>
    <View style={{ backgroundColor: '#293D33', flex: wide ? 1 : undefined, padding: wide ? 64 : 28, justifyContent: 'space-between', gap: wide ? 75 : 20 }}>
      <Brand light />
      {wide ? <View style={{ gap: 25, maxWidth: 510 }}><Text style={[s.eyebrow, { color: '#CEDBB6' }]}>PEQUENAS ETIQUETAS. GRANDES REENCONTROS.</Text><Text style={{ fontSize: wide ? 62 : 39, lineHeight: wide ? 66 : 43, letterSpacing: -2.5, color: '#F5F5E9', fontWeight: '500' }}>O que é seu{ '\n' }encontra o{ '\n' }caminho de volta<Text style={{ color: '#D9EE9B' }}>.</Text></Text><Text style={{ color: '#CCD6CB', fontSize: 16, lineHeight: 26, maxWidth: 355 }}>Um QR no seu objeto. Uma pessoa disposta a ajudar. Uma chance a mais de reencontro.</Text></View> : <Text style={{ color: '#CCD6CB', fontSize: 16, lineHeight: 24 }}>Um QR no objeto. Uma chance de reencontro.</Text>}
      {wide && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, paddingVertical: 14 }}><View style={{ width: 110, height: 145, backgroundColor: '#D9EE9B', borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 15, transform: [{ rotate: '-9deg' }] }}><View style={{ width: 23, height: 7, borderRadius: 5, backgroundColor: '#293D33' }} /><Icon name="crosshair" size={49} color="#293D33" /><Text style={{ fontSize: 9, letterSpacing: 2 }}>HELLO, AGAIN.</Text></View><View style={{ gap: 9 }}><Text style={{ color: '#F5F5E9', fontWeight: '600' }}>Mais cuidado. Menos preocupação.</Text><Text style={{ color: '#CCD6CB', lineHeight: 23 }}>Sem bateria. Sem rastreamento.{ '\n' }Seus contatos continuam privados.</Text></View></View>}
      {wide && <Text style={{ color: '#AABDAA', fontSize: 12 }}>Feito para coisas que têm uma história com você.</Text>}
    </View>
    <View style={{ flex: 1, padding: wide ? 60 : 28, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: '100%', maxWidth: 380, gap: 23 }}>
      <View style={{ gap: 10 }}><Text style={s.eyebrow}>BEM-VINDO AO SEEKERTAG</Text><Text accessibilityRole="header" style={s.h1}>{mode === 'register' ? 'Vamos cuidar\ndo que é seu.' : mode === 'recover' ? 'De volta\nà sua conta.' : 'Bom ter você\npor aqui.'}</Text><Text style={s.body}>{mode === 'register' ? 'Crie sua conta e sua primeira etiqueta em poucos passos.' : mode === 'recover' ? 'Use o código que você guardou ao criar sua conta.' : 'Entre para acompanhar seus objetos e conversas.'}</Text></View>
      {error ? <Notice error text={error} /> : null}
      {mode === 'register' && <Field label="Seu nome" value={name} onChangeText={setName} placeholder="Como você gosta de ser chamado?" autoComplete="name" maxLength={80} />}
      <Field label="E-mail" value={email} onChangeText={setEmail} placeholder="voce@exemplo.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" maxLength={254} />
      {mode === 'recover' && <Field label="Código de recuperação" value={code} onChangeText={setCode} autoCapitalize="none" />}
      <Field label={mode === 'recover' ? 'Nova senha' : 'Senha'} value={password} onChangeText={setPassword} placeholder={mode === 'login' ? 'Sua senha' : 'Pelo menos 10 caracteres'} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onSubmitEditing={submit} maxLength={128} />
      <Button onPress={submit} busy={busy} icon="arrow-right">{mode === 'register' ? 'Criar conta' : mode === 'recover' ? 'Recuperar conta' : 'Entrar'}</Button>
      <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap' }]}><Text style={s.small}>{mode === 'register' ? 'Já tem uma conta?' : 'Ainda não tem conta?'}</Text><Pressable accessibilityRole="button" onPress={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }} style={{ paddingVertical: 10 }}><Text style={{ color: C.purple, fontWeight: '600', fontSize: 13 }}>{mode === 'register' ? 'Entrar' : 'Criar conta'}</Text></Pressable></View>
      {mode === 'login' && <Button variant="ghost" onPress={() => setMode('recover')}>Esqueci minha senha</Button>}
      <View style={s.divider} /><Button variant="secondary" icon="maximize" onPress={onScan}>Encontrei um objeto</Button><Text style={[s.small, { textAlign: 'center' }]}>Quem encontra não precisa criar conta.{ '\n' }Basta abrir o QR da etiqueta para avisar o dono.</Text>
    </View></View>
  </View></ScrollView>;
}
