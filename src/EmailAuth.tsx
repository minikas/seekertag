import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import React, { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Pressable from './HapticPressable';
import { api, User } from './api';
import { Brand, Button, Field, Icon, Notice, useUI } from './ui';

export default function EmailAuth({ onAuth, onScan }: { onAuth: (token: string, user: User, recoveryCode?: string) => Promise<void>; onScan: () => void }) {
  const { C, s, t, locale } = useUI();
  const { width } = useWindowDimensions();
  const wide = width >= 850;
  const [mode, setMode] = useState<'register' | 'login' | 'recover'>('login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!email.trim() || !password || (mode === 'register' && !name.trim())) { setError('Preencha os campos para continuar.'); return; }
    if (mode !== 'login' && password.length < 10) { setError('Escolha uma senha com pelo menos 10 caracteres.'); return; }
    setBusy(true); setError('');
    try { const result = await api<{ token: string; user: User; recoveryCode?: string }>(`/auth/${mode}`, null, { email: email.trim(), password, ...(mode === 'register' ? { name: name.trim() } : {}), ...(mode === 'recover' ? { recoveryCode: code.trim() } : {}) }); await onAuth(result.token, result.user, result.recoveryCode); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ flexGrow: 1, backgroundColor: C.bg }} keyboardShouldPersistTaps="handled"><View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', minHeight: wide ? 760 : undefined }}>
    <View style={{ backgroundColor: C.surface, flex: wide ? 1 : undefined, padding: wide ? 64 : 28, justifyContent: 'space-between', gap: wide ? 75 : 20 }}>
      <Brand />
      {wide ? <View style={{ gap: 25, maxWidth: 510 }}><Text style={{ fontSize: wide ? 62 : 39, lineHeight: wide ? 66 : 43, letterSpacing: -2.5, color: C.ink, fontWeight: '500' }}>{t("O que é seu")}{ '\n' }{t("encontra o")}{ '\n' }{t("caminho de volta")}<Text style={{ color: C.accent }}>.</Text></Text><Text style={{ color: C.muted, fontSize: 16, lineHeight: 26, maxWidth: 355 }}>{t("Um QR no seu objeto. Uma pessoa disposta a ajudar. Uma chance a mais de reencontro.")}</Text></View> : <Text style={{ color: C.muted, fontSize: 16, lineHeight: 24 }}>{t("Um QR no objeto. Uma chance de reencontro.")}</Text>}
      {wide && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, paddingVertical: 14 }}><View style={{ width: 110, height: 145, backgroundColor: C.accent, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 15, transform: [{ rotate: '-9deg' }] }}><View style={{ width: 23, height: 7, borderRadius: 5, backgroundColor: C.onAccent }} /><Icon name="crosshair" size={49} color={C.onAccent} /></View><View style={{ gap: 9 }}><Text style={{ color: C.muted, lineHeight: 23 }}>{t("Sem bateria. Sem rastreamento.")}{ '\n' }{t("Seus contatos continuam privados.")}</Text></View></View>}
    </View>
    <View style={{ flex: 1, padding: wide ? 60 : 28, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: '100%', maxWidth: 380, gap: 23 }}>
      <View style={{ gap: 10 }}><Text accessibilityRole="header" style={s.h1}>{mode === 'register' ? t("Vamos cuidar\ndo que é seu.") : mode === 'recover' ? t("De volta\nà sua conta.") : t("Bom ter você\npor aqui.")}</Text><Text style={s.body}>{mode === 'register' ? t("Crie sua conta e sua primeira etiqueta em poucos passos.") : mode === 'recover' ? t("Use o código que você guardou ao criar sua conta.") : t("Entre para acompanhar seus objetos e conversas.")}</Text></View>
      {error ? <Notice error text={error} /> : null}
      {mode === 'register' && <Field label={t("Seu nome")} value={name} onChangeText={setName} placeholder={t("Como você gosta de ser chamado?")} autoComplete="name" maxLength={80} />}
      <Field label={t("E-mail")} value={email} onChangeText={setEmail} placeholder="email@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" maxLength={254} />
      {mode === 'recover' && <Field label={t("Código de recuperação")} value={code} onChangeText={setCode} autoCapitalize="none" />}
      <Field label={mode === 'recover' ? t("Nova senha") : t("Senha")} value={password} onChangeText={setPassword} placeholder={mode === 'login' ? t("Sua senha") : t("Pelo menos 10 caracteres")} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onSubmitEditing={submit} maxLength={128} />
      <Button onPress={submit} busy={busy} icon="arrow-right">{mode === 'register' ? t("Criar conta") : mode === 'recover' ? t("Recuperar conta") : t("Entrar")}</Button>
      <View style={[s.row, { justifyContent: 'center', flexWrap: 'wrap' }]}><Text style={s.small}>{mode === 'register' ? t("Já tem uma conta?") : t("Ainda não tem conta?")}</Text><Pressable accessibilityRole="button" onPress={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }} style={{ paddingVertical: 10 }}><Text style={{ color: C.accent, fontWeight: '600', fontSize: 16 }}>{mode === 'register' ? t("Entrar") : t("Criar conta")}</Text></Pressable></View>
      {mode === 'login' && <Button variant="ghost" onPress={() => setMode('recover')}>{t("Esqueci minha senha")}</Button>}
      <View style={s.divider} /><Button variant="secondary" icon="maximize" onPress={onScan}>{t("Encontrei um objeto")}</Button><Text style={[s.small, { textAlign: 'center' }]}>{t("Quem encontra não precisa criar conta.")}{ '\n' }{t("Basta abrir o QR da etiqueta para avisar o dono.")}</Text>
    </View></View>
  </View></KeyboardAwareScrollView>;
}
