import React, { useRef } from 'react';
import { Text, View } from 'react-native';
import type { RewardView } from '@seekertag/shared/reward';
import AccountActionSheet from './AccountActionSheet';
import type { AccountActionSheetHandle } from './AccountActionSheet';
import { useReward } from './useReward';
import RewardReview, { Address, RewardReviewAction } from './RewardReview';
import RewardSummary from './RewardSummary';
import { Button, Notice, useUI } from './ui';

export default function RewardReleaseSheet({ tagId, token, reportId, recipient, onClose, onChanged, onReleased }: {
  tagId: string; token: string; reportId: string; recipient: string | null; onClose: () => void;
  onChanged: (reward: RewardView | null) => void; onReleased: () => void;
}) {
  const { C, s, t } = useUI(); const sheet = useRef<AccountActionSheetHandle>(null);
  const released = useRef(false);
  const wallet = useReward({ tagId, token, currency: 'SOL', reportId, recipient, onChanged,
    onReleased: () => { released.current = true; }, onCompleted: () => sheet.current?.dismiss() });
  const editableReview = !wallet.busy && ['prepared', 'expired'].includes(wallet.operation?.status || '');
  return <AccountActionSheet ref={sheet} title={t('Finalizar devolução')} busy={wallet.busy}
    onBack={editableReview ? wallet.discardReview : undefined} onClose={() => { if (released.current) onReleased(); onClose(); }}>
    {!!wallet.error && <Notice error text={wallet.error} />}
    {wallet.operation ? <><RewardReview controller={wallet} /><RewardReviewAction controller={wallet} releaseAllowed={!!recipient} /></> : wallet.loading ? <RewardReleaseSkeleton /> : <View style={{ gap: 20 }}>
      <Text style={s.body}>{t('Confirme somente se o objeto já estiver com você. O pagamento é definitivo e encerra as conversas deste objeto.')}</Text>
      <RewardSummary reward={wallet.data?.reward} />
      {recipient ? <Address label={t('Carteira de quem encontrou')} address={recipient} /> : <Notice text={t('Quem encontrou precisa confirmar a carteira de recebimento na conversa.')} />}
      <Button variant="success" icon="check-circle" busy={wallet.busy} disabled={!recipient || !['reserved', 'expired'].includes(wallet.data?.reward?.status || '')} onPress={() => void wallet.review('release')}>{t('Confirmar devolução e pagar')}</Button>
    </View>}
  </AccountActionSheet>;
}

function RewardReleaseSkeleton() {
  const { C } = useUI();
  return <View accessibilityLabel="Carregando recompensa" style={{ gap: 20 }}>
    <View style={{ height: 100, borderRadius: 22, backgroundColor: C.surface }} />
    <View style={{ height: 72, borderRadius: 18, backgroundColor: C.surface }} />
    <View style={{ width: '86%', height: 16, borderRadius: 8, backgroundColor: C.surface }} />
    <View style={{ height: 52, borderRadius: 18, backgroundColor: C.surface }} />
  </View>;
}
