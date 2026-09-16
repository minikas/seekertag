import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Tag } from './api';
import { categoryInk, tagCategoryLabel } from './category.model';
import { conversationCount } from './i18n';
import Pressable from './HapticPressable';
import { Icon, IconName, useUI } from './ui';

export default function TagRow({ tag, onPress, last = false }: { tag: Tag; onPress: () => void; last?: boolean }) {
  const { C, s, t, locale } = useUI();
  const status = tag.status === 'lost' ? { label: t('Perdido'), color: C.amber } : tag.status === 'paused' ? { label: t('Pausado'), color: C.muted } : { label: t('Protegido'), color: C.green };
  return <Pressable accessibilityRole="button" accessibilityLabel={t('Abrir {name}', { name: tag.name })} onPress={onPress}
    style={({ pressed }) => [styles.row, { borderBottomColor: C.line }, last && { borderBottomWidth: 0 }, pressed && { opacity: 0.65 }]}>
    <View style={[styles.icon, { backgroundColor: tag.color }]}><Icon name={(tag.categoryIcon || 'box') as IconName} color={categoryInk(tag.color)} size={23} /></View>
    <View style={styles.content}>
      <Text numberOfLines={2} style={s.h3}>{tag.name}</Text>
      <Text style={s.small}>{tagCategoryLabel(tag, t)}</Text>
      {tag.openReportCount > 0 && <Text style={[s.small, { color: C.accent }]}>{conversationCount(t, tag.openReportCount, locale)}</Text>}
    </View>
    <Text style={[s.small, { color: status.color }]}>{status.label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 22, minHeight: 98, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, gap: 5 },
});
