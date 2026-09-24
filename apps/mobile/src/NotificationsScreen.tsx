import React, { useEffect } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import Pressable from './HapticPressable';
import { NavigationScope, useNavigationLayer } from './Navigation';
import { useNotifications } from './NotificationsProvider';
import { Button, formatDate, Icon, Notice, useUI } from './ui';

export default function NotificationsScreen({ onClose, covered = false }: { onClose: () => void; covered?: boolean }) {
  const { C, s, t, locale } = useUI();
  const inbox = useNotifications();
  const layer = useNavigationLayer(onClose);
  return <NavigationScope path={layer.path}><View style={{ flex: 1, backgroundColor: C.bg }} accessibilityElementsHidden={covered || !layer.active} importantForAccessibility={covered || !layer.active ? 'no-hide-descendants' : 'auto'}>
    <View style={s.screenHeader}>
      <Button variant="ghost" icon="arrow-left" label={t('Voltar')} onPress={onClose} />
      <Text accessibilityRole="header" numberOfLines={2} style={s.screenTitle}>{t('Notificações')}</Text>
      <Button variant="ghost" icon="check-circle" label={t('Marcar todas como lidas')} disabled={!inbox.unreadCount}
        onPress={() => void inbox.markRead(inbox.latestId)} />
    </View>
    <FlatList data={inbox.notifications} keyExtractor={item => String(item.id)} style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24, maxWidth: 600, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={inbox.loading} onRefresh={() => void inbox.refresh()} tintColor={C.accent} colors={[C.accent]} />}
      ListHeaderComponent={<View style={{ gap: 14, paddingVertical: 16 }}>
        <Text style={s.body} accessibilityLiveRegion="polite">{inbox.unreadCount ? t('{count} não lidas', { count: inbox.unreadCount.toLocaleString(locale) }) : t('Você está em dia.')}</Text>
        {!!inbox.error && <Notice error text={inbox.error} />}
        {!inbox.permission ? <View style={{ backgroundColor: C.surface, borderRadius: 20, padding: 18, gap: 12 }}>
          <Text style={s.h3}>{t('Receba avisos de novas mensagens')}</Text>
          <Text style={s.body}>{t('Permita as notificações para acompanhar suas conversas.')}</Text>
          <Button variant="secondary" icon="bell" onPress={() => void inbox.enable()}>{t('Ativar notificações')}</Button>
        </View> : !inbox.pushReady ? <Text style={s.small}>{t('Os avisos funcionam enquanto o app está aberto. As mensagens recebidas fora do app aparecem aqui ao voltar.')}</Text> : null}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.read ? '' : t('Não lida') + '. '}${item.tagName}. ${item.kind === 'wallet_confirmed' ? t(item.body) : item.body}`}
        onPress={() => inbox.open(item)} style={({ pressed }) => ({ flexDirection: 'row', gap: 14, padding: 16, marginBottom: 10,
          borderRadius: 20, backgroundColor: item.read ? C.bg : C.surface, opacity: pressed ? 0.65 : 1 })}>
        <View style={[s.circle, { backgroundColor: item.read ? C.surface : C.soft }]}><Icon name="message-circle" color={item.read ? C.muted : C.accent} /></View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text numberOfLines={2} style={[s.h3, { flex: 1 }]}>{item.tagName}</Text>
            {!item.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />}</View>
          <Text style={s.small}>{item.finder ? t('Dono') : item.senderName}</Text>
          <Text numberOfLines={3} style={s.body}>{item.kind === 'wallet_confirmed' ? t(item.body) : item.body}</Text>
          <Text style={s.small}>{formatDate(item.createdAt, locale)}</Text>
        </View>
      </Pressable>}
      ListEmptyComponent={inbox.loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} /> : inbox.error ? <Button variant="secondary" onPress={() => void inbox.refresh()}>{t('Tentar novamente')}</Button> :
        <View style={[s.empty, { flex: 1 }]}><View style={[s.circle, { width: 72, height: 72, borderRadius: 26 }]}><Icon name="bell" size={30} /></View>
          <Text style={[s.h2, { textAlign: 'center' }]}>{t('Nenhuma notificação por enquanto')}</Text>
          <Text style={[s.body, { textAlign: 'center' }]}>{t('Quando alguém enviar uma mensagem, o aviso aparece aqui.')}</Text></View>}
      ListFooterComponent={inbox.nextCursor ? <Button variant="ghost" busy={inbox.loading} onPress={() => void inbox.loadMore()}>{t('Carregar mais')}</Button> : null} />
  </View></NavigationScope>;
}
