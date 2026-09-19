import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Keyboard, Text, View } from 'react-native';
import { api } from './api';
import { useMutation } from '@tanstack/react-query';
import AccountActionSheet from './AccountActionSheet';
import { Button, Field, Notice, useUI } from './ui';
import { confirmFinderWallet, prepareFinderWallet, type FinderWalletApproval } from './platform/reward-wallet';
import { receivingWalletFormSchema, type ReceivingWalletFormValues } from './form.model';

type Props = {
  id: string; token: string; recipient?: string | null; onSaved: (address: string) => void; onClose: () => void;
};
type FormState = { busy: boolean; dirty: boolean; reviewing: boolean; onBack?: () => void };
type Review = { method: 'address' | 'wallet'; recipient: string };
export default function ReceivingWalletSheet(props: Props) {
  const { t } = useUI();
  const [state, setState] = useState<FormState>({ busy: false, dirty: false, reviewing: false });
  const guardClose = (dismiss: () => void) => {
    if (state.busy) return;
    if (!state.dirty) { dismiss(); return; }
    Alert.alert(t('Descartar alterações?'), t('As alterações não salvas serão perdidas.'), [
      { text: t('Continuar editando'), style: 'cancel' },
      { text: t('Descartar'), style: 'destructive', onPress: dismiss },
    ]);
  };
  return <AccountActionSheet title={t(state.reviewing ? 'Revisar carteira' : 'Sua carteira de recebimento')} busy={state.busy} onBack={state.onBack} guardClose={guardClose} onClose={props.onClose}>
    <ReceivingWalletForm {...props} onStateChange={setState} />
  </AccountActionSheet>;
}

export function ReceivingWalletForm({ id, token, recipient, onSaved, onStateChange }: Omit<Props, 'onClose'> & {
  onStateChange: (state: FormState) => void;
}) {
  const { s, t, locale } = useUI();
  const { control, handleSubmit, watch, setValue, reset, setError, clearErrors, formState: { errors } } = useForm<ReceivingWalletFormValues>({
    resolver: zodResolver(receivingWalletFormSchema), mode: 'onChange', defaultValues: { address: recipient || '' },
  });
  const address = watch('address');
  const [review, setReview] = useState<Review | null>(null);
  // Proofs remain ephemeral component state. They are never query data,
  // mutation variables/results, persisted storage or navigation parameters.
  const approval = useRef<FinderWalletApproval | null>(null);
  const identity = `${id}:${token}`;
  const activeIdentity = useRef(identity); activeIdentity.current = identity;
  const mounted = useRef(true);
  const acting = useRef(false);
  const current = () => mounted.current && activeIdentity.current === identity;
  useEffect(() => {
    mounted.current = true; approval.current = null; setReview(null);
    reset({ address: recipient || '' });
    return () => { mounted.current = false; approval.current = null; };
  }, [identity, reset]);
  const connectMutation = useMutation({
    retry: false, networkMode: 'always',
    mutationFn: async () => {
      const pending = await prepareFinderWallet(id, token, locale.slice(0, 2));
      if (!current() || !pending) return;
      approval.current = pending;
      setValue('address', pending.recipient, { shouldValidate: true });
      setReview({ method: 'wallet', recipient: pending.recipient });
    },
  });
  const saveMutation = useMutation({
    retry: false, networkMode: 'always',
    mutationFn: async () => {
      if (!review || !current()) return;
      if (review.method === 'wallet') {
        const pending = approval.current;
        if (!pending || pending.recipient !== review.recipient) throw new Error('Conecte sua carteira para continuar.');
        return confirmFinderWallet(id, token, pending);
      }
      return (await api<{ recipient: string }>(`/finder/reports/${id}/reward/wallet`, token, { address: review.recipient })).recipient;
    },
  });
  const busy = connectMutation.isPending || saveMutation.isPending;
  const back = useCallback(() => {
    if (acting.current) return;
    approval.current = null; setReview(null); clearErrors('root');
  }, [clearErrors]);
  useEffect(() => {
    onStateChange({ busy, dirty: address.trim() !== (recipient || ''), reviewing: !!review, onBack: review ? back : undefined });
  }, [busy, address, recipient, review, back, onStateChange]);

  function reviewAddress(values: ReceivingWalletFormValues) {
    if (acting.current) return;
    Keyboard.dismiss(); clearErrors('root'); approval.current = null;
    setReview({ method: 'address', recipient: values.address });
  }
  async function connect() {
    if (acting.current) return;
    acting.current = true; clearErrors('root'); Keyboard.dismiss();
    try { await connectMutation.mutateAsync(); }
    catch (cause) { if (current()) setError('root', { type: 'server', message: (cause as Error).message }); }
    finally { acting.current = false; }
  }
  async function confirm() {
    if (acting.current || !review) return;
    acting.current = true; clearErrors('root'); Keyboard.dismiss();
    try {
      const saved = await saveMutation.mutateAsync();
      if (current() && saved) { approval.current = null; onSaved(saved); }
    } catch (cause) {
      // Keep the reviewed address visible so a failed save can be retried or
      // edited with Back, without silently replacing the existing recipient.
      if (current()) setError('root', { type: 'server', message: (cause as Error).message });
    } finally { acting.current = false; }
  }
  if (review) return <View style={{ gap: 20 }}>
    <Text style={s.body}>{t('Esta carteira receberá a recompensa desta conversa.')}</Text>
    <View style={[s.card, { gap: 8 }]}>
      <Text style={s.small}>{t('Endereço da carteira Solana')}</Text>
      <Text selectable style={[s.body, { fontFamily: 'monospace' }]}>{review.recipient}</Text>
    </View>
    {!!recipient && recipient !== review.recipient && <View style={{ gap: 6 }}>
      <Text style={s.small}>{t('Carteira atual')}</Text>
      <Text selectable style={s.small}>{recipient}</Text>
    </View>}
    <Text style={s.small}>{t('Confira o endereço antes de confirmar. Ele ficará vinculado a esta conversa e receberá a recompensa quando o dono confirmar a devolução.')}</Text>
    {!!errors.root?.message && <Notice error text={errors.root.message} />}
    <Button variant="accent" icon="check" onPress={() => void confirm()} busy={saveMutation.isPending}>{t('Confirmar carteira de recebimento')}</Button>
  </View>;
  return <View style={{ gap: 20 }}>
    <Text style={s.body}>{t('Informe o endereço da sua carteira Solana. Não é necessário conectar uma carteira nem ter um Seeker.')}</Text>
    <Controller control={control} name="address" render={({ field }) => <Field inSheet label={t('Endereço da carteira Solana')}
      value={field.value} onChangeText={value => { field.onChange(value); clearErrors('root'); }} onBlur={field.onBlur}
      error={errors.address?.message ? t(errors.address.message) : undefined}
      autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={100} editable={!busy} multiline style={{ minHeight: 88 }}
      placeholder={t('Cole o endereço da carteira')} />} />
    {!!errors.root?.message && <Notice error text={errors.root.message} />}
    <View style={{ gap: 8 }}>
      <Button variant="accent" icon="arrow-right" onPress={() => void handleSubmit(reviewAddress)()} disabled={!address.trim() || !!errors.address || busy}>{t('Conferir endereço')}</Button>
      <Button variant="ghost" icon="link" onPress={() => void connect()} busy={connectMutation.isPending} disabled={saveMutation.isPending}>{t('Conectar carteira (opcional)')}</Button>
    </View>
  </View>;
}
