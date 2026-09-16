import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Tag } from './api';
import { categoryInk, tagCategoryLabel } from './category.model';
import { conversationCount } from './i18n';
import Pressable from './HapticPressable';
import { Icon, IconName, Pill, useUI } from './ui';

export default function TagRow({ tag, onPress }: { tag: Tag; onPress: () => void }) {
  const { C, s, t, locale } = useUI();
  return <Pressable accessibilityRole="button" accessibilityLabel={t('Abrir {name}', { name: tag.name })} onPress={onPress}
    style={({ pressed }) => [styles.row, { borderBottomColor: C.line }, pressed && { opacity: 0.65 }]}>
    <View style={[s.circle, { backgroundColor: tag.color }]}><Icon name={(tag.categoryIcon || 'box') as IconName} color={categoryInk(tag.color)} size={26} /></View>
    <View style={styles.content}>
      <Text numberOfLines={2} style={s.h3}>{tag.name}</Text>
      <View style={[s.row, styles.metadata]}><Text style={s.small}>{tagCategoryLabel(tag, t)}</Text><Pill status={tag.status} /></View>
      {tag.openReportCount > 0 && <Text style={[s.small, { color: C.accent }]}>{conversationCount(t, tag.openReportCount, locale)}</Text>}
    </View>
    <Icon name="chevron-right" color={C.muted} size={22} />
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 22, minHeight: 106, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, gap: 8 },
  metadata: { flexWrap: 'wrap', gap: 8 },
});
