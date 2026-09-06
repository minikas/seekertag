import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api, ApiError, User } from './api';
import { Brand, Button, C, Field, Notice, s } from './ui';

export type AuthProps = {
  onAuth: (token: string, user: User, recoveryCode?: string) => Promise<void>;
  onScan: () => void;
  savedConversations?: React.ReactNode;
};

export default function Auth({ onAuth, onScan, savedConversations }: AuthProps) {
  const [mode, setMode] = useState<'register' | 'login' | 'recover'>('register');
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  function changeMode(next: typeof mode) { setMode(next); setError(''); setPassword(''); setCode(''); }
  async function submit() {
    if (busy) return;
    if (!email.trim() || !password || (mode === 'register' && !name.trim())) { setError('Preencha os campos para continuar.'); return; }
    if (mode !== 'login' && password.length < 10) { setError('Escolha uma senha com pelo menos 10 caracteres.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ token: string; user: User; recoveryCode?: string }>(`/auth/${mode}`, null, { email: email.trim(), password, ...(mode === 'register' ? { name: name.trim() } : {}), ...(mode === 'recover' ? { recoveryCode: code.trim() } : {}) });
      await onAuth(result.token, result.user, result.recoveryCode);
    } catch (e) { setError(mode === 'recover' && !(e instanceof ApiError) ? 'Não foi possível confirmar a recuperação. Tente entrar com a nova senha. Se funcionar, gere outro código em Minha conta; se não, use novamente o código que você guardou.' : (e as Error).message); } finally { setBusy(false); }
  }

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 20, paddingTop: 24, paddingBottom: 36, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 420, gap: 20 }}>
        <Brand />
        <View style={{ gap: 8 }}>
          <View style={s.row}>
            <Button onPress={() => changeMode('register')} variant={mode === 'register' ? 'primary' : 'secondary'} style={{ flex: 1 }} disabled={busy}>Criar etiqueta</Button>
            <Button onPress={() => changeMode('login')} variant={mode === 'login' ? 'primary' : 'secondary'} style={{ flex: 1 }} disabled={busy}>Entrar</Button>
          </View>
          <Button variant="secondary" icon="maximize" onPress={onScan}>Encontrei um objeto</Button>
        </View>
        {savedConversations}
        <View style={{ gap: 14 }}>
          <Text accessibilityRole="header" style={s.h2}>{mode === 'register' ? 'Criar conta' : mode === 'recover' ? 'Recuperar conta' : 'Entrar na conta'}</Text>
          {mode === 'recover' && <Text style={s.body}>Use o código que você guardou ao criar sua conta.</Text>}
          {!!error && <Notice error text={error} />}
          {mode === 'register' && <Field label="Seu nome" value={name} onChangeText={setName} placeholder="Seu nome" autoComplete="name" maxLength={80} editable={!busy} />}
          <Field label="E-mail" value={email} onChangeText={setEmail} placeholder="voce@exemplo.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" maxLength={254} editable={!busy} />
          {mode === 'recover' && <Field label="Código de recuperação" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} editable={!busy} />}
          <Field label={mode === 'recover' ? 'Nova senha' : 'Senha'} value={password} onChangeText={setPassword} placeholder={mode === 'login' ? 'Sua senha' : 'Pelo menos 10 caracteres'} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onSubmitEditing={submit} maxLength={128} editable={!busy} />
          <Button onPress={submit} busy={busy} icon="arrow-right">{mode === 'register' ? 'Criar conta' : mode === 'recover' ? 'Recuperar conta' : 'Entrar na conta'}</Button>
          {mode === 'login' && <Button variant="ghost" onPress={() => changeMode('recover')}>Esqueci minha senha</Button>}
        </View>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
