import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api, ApiError } from './api';
import { completeMutation, executeMutation, loadPendingMutation, PendingMutation, prepareMutation } from './mutations';
import { Button, C, Field, Notice, s } from './ui';

type Settings = { available: boolean; verified: boolean; enabled: boolean; pending: boolean; failedCount: number };
export default function NotificationsPanel({ token, userId, email }: { token: string; userId: string; email: string }) {
  const [settings, setSettings] = useState<Settings>();
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const scope = `email-verification-${userId}`;
  useEffect(() => {
    const current = ++generation.current;
    void Promise.all([api<Settings>('/account/notifications', token), loadPendingMutation(scope)])
      .then(([value, saved]) => { if (generation.current === current) { setSettings(value); setPending(saved); } })
      .catch(issue => { if (generation.current === current) setError((issue as Error).message); });
    return () => { generation.current++; };
  }, [token, scope]);

  async function action(kind: 'request' | 'verify' | 'toggle' | 'reload') {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const current = generation.current;
    let operation: PendingMutation | null = null;
    try {
      let result: Settings;
      if (kind === 'request') {
        operation = await prepareMutation(scope, '/account/notifications/verification', {});
        if (generation.current === current) setPending(operation);
        result = await executeMutation<Settings>(operation, token);
        await completeMutation(operation);
        if (generation.current === current) setPending(null);
      } else if (kind === 'verify') {
        result = await api<Settings>('/account/notifications/verify', token, { code: code.trim() });
        const previous = await loadPendingMutation(scope);
        if (previous) await completeMutation(previous);
        if (generation.current === current) { setPending(null); setCode(''); }
      } else if (kind === 'toggle') {
        result = await api<Settings>('/account/notifications', token, { enabled: !settings?.enabled }, 'PATCH');
      } else result = await api<Settings>('/account/notifications', token);
      if (generation.current === current) setSettings(result);
    } catch (issue) {
      // An expired challenge explicitly cannot be retried. A transport error
      // remains ambiguous and keeps the operation key for the next request.
      if (operation && issue instanceof ApiError && issue.code === 'VERIFICATION_EXPIRED') {
        await completeMutation(operation);
        if (generation.current === current) setPending(null);
      }
      if (generation.current === current) {
        setError((issue as Error).message);
        if (issue instanceof ApiError && issue.code === 'EMAIL_DELIVERY_UNCERTAIN') setSettings(old => old && { ...old, pending: true });
      }
    } finally { busyRef.current = false; if (generation.current === current) setBusy(false); }
  }

  return <View style={{ gap: 12 }}>
    <Button variant="secondary" icon="mail" expanded={expanded} onPress={() => setExpanded(value => !value)}>Avisos por e-mail</Button>
    {expanded && <View style={{ gap: 14 }}>
      {!!error && <Notice error text={error} />}
      {!settings ? error ? <Button busy={busy} variant="secondary" onPress={() => void action('reload')}>Tentar novamente</Button> : <ActivityIndicator color={C.purple} /> : <>
        {!settings.available ? <Text style={s.body}>Os avisos por e-mail ainda não estão disponíveis. Acompanhe as mensagens em Conversas.</Text> : <>
          <Text style={s.body}>{settings.verified ? settings.enabled ? `Você recebe avisos em ${email}.` : 'Os avisos por e-mail estão desativados.' : `Receba um aviso quando alguém enviar uma mensagem. Primeiro, confirme ${email}.`}</Text>
          {settings.verified ? <Button variant="secondary" busy={busy} onPress={() => void action('toggle')}>{settings.enabled ? 'Desativar avisos' : 'Ativar avisos'}</Button> : <>
            <Button variant="secondary" busy={busy} onPress={() => void action('request')}>{pending ? 'Tentar enviar o código novamente' : settings.pending ? 'Pedir outro código' : 'Enviar código por e-mail'}</Button>
            {(settings.pending || pending) && <>
              <Field label="Código de confirmação" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} editable={!busy} onSubmitEditing={() => void action('verify')} />
              <Button busy={busy} disabled={!/^\d{6}$/.test(code.trim())} onPress={() => void action('verify')}>Confirmar e ativar avisos</Button>
            </>}
          </>}
          <Text style={s.small}>O e-mail não mostra o conteúdo da conversa. Você entra na conta para ler e pode desativar os avisos a qualquer momento.</Text>
        </>}
        {settings.failedCount > 0 && <Notice text="Alguns avisos não puderam ser enviados. Suas mensagens continuam disponíveis em Conversas." />}
      </>}
    </View>}
  </View>;
}
