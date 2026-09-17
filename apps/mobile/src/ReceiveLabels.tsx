import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Notice, useUI } from './ui';

export default function ReceiveLabels({ accountId }: { accountId: string }) {
  const { C, s, t } = useUI();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copyReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyReset.current) clearTimeout(copyReset.current); }, []);
  async function copyId() {
    try {
      await Clipboard.setStringAsync(accountId); setCopied(true); setError('');
      if (copyReset.current) clearTimeout(copyReset.current);
      copyReset.current = setTimeout(() => setCopied(false), 2000);
    } catch { setError('Não foi possível copiar. Toque e segure o ID para selecioná-lo.'); }
  }
  return <>
    <Text style={s.body}>{t("Envie este ID para quem vai transferir uma etiqueta para você.")}</Text>
    <View style={[s.card, { gap: 12 }]}><Text style={s.label}>{t("ID da conta")}</Text><Text selectable style={[s.small, { color: C.ink }]}>{accountId}</Text></View>
    <Button icon={copied ? 'check' : 'copy'} onPress={() => void copyId()}>{copied ? t("ID copiado") : t("Copiar ID da conta")}</Button>
    {!!error && <Notice error text={error} />}
  </>;
}
