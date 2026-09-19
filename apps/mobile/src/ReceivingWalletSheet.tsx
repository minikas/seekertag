import React, { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Keyboard, Text, View } from 'react-native';
import { api, ApiError } from './api';
import AccountActionSheet from './AccountActionSheet';
import { Button, Field, Notice, useUI } from './ui';
import { confirmFinderWallet } from './platform/reward-wallet';
import { receivingWalletFormSchema, type ReceivingWalletFormValues } from './form.model';

export default function ReceivingWalletSheet({ id, token, onSaved, onClose }: {
  id: string; token: string; onSaved: (address: string) => void; onClose: () => void;
}) {
  const { s, t, locale } = useUI();
  const { control, handleSubmit, watch, setError, clearErrors, formState: { errors } } = useForm<ReceivingWalletFormValues>({
    resolver: zodResolver(receivingWalletFormSchema), mode: 'onChange', defaultValues: { address: '' },
  });
  const address = watch('address');
  const [busy, setBusy] = useState<'address' | 'wallet' | null>(null);
  const acting = useRef(false);
  async function save(method: 'address' | 'wallet', recipient?: string) {
    if (acting.current) return;
    acting.current = true; setBusy(method); clearErrors('root'); Keyboard.dismiss();
    try {
      const saved = method === 'address'
        ? (await api<{ recipient: string }>(`/finder/reports/${id}/reward/wallet`, token, { address: recipient })).recipient
        : await confirmFinderWallet(id, token, locale.slice(0, 2));
      if (saved) onSaved(saved);
    } catch (cause) {
      setError(method === 'address' && cause instanceof ApiError && cause.status === 400 ? 'address' : 'root', { type: 'server', message: (cause as Error).message });
    }
    finally { acting.current = false; setBusy(null); }
  }
  return <AccountActionSheet title={t('Sua carteira de recebimento')} busy={!!busy} onClose={onClose}>
    <Text style={s.body}>{t('Informe o endereço da sua carteira Solana. Não é necessário conectar uma carteira nem ter um Seeker.')}</Text>
    <Controller control={control} name="address" render={({ field }) => <Field inSheet label={t('Endereço da carteira Solana')}
      value={field.value} onChangeText={value => { field.onChange(value); clearErrors('root'); }} onBlur={field.onBlur}
      error={errors.address?.message ? t(errors.address.message) : undefined}
      autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={100} editable={!busy} multiline style={{ minHeight: 88 }}
      placeholder={t('Cole o endereço da carteira')} />} />
    <Text style={s.small}>{t('Confira o endereço antes de confirmar. Ele ficará vinculado a esta conversa e receberá a recompensa quando o dono confirmar a devolução.')}</Text>
    {!!errors.root?.message && <Notice error text={errors.root.message} />}
    <View style={{ gap: 8 }}>
      <Button variant="accent" icon="check" onPress={() => void handleSubmit(values => save('address', values.address))()} busy={busy === 'address'} disabled={!address.trim() || !!errors.address || busy === 'wallet'}>{t('Confirmar endereço')}</Button>
      <Button variant="ghost" icon="link" onPress={() => void save('wallet')} busy={busy === 'wallet'} disabled={busy === 'address'}>{t('Conectar carteira (opcional)')}</Button>
    </View>
  </AccountActionSheet>;
}
