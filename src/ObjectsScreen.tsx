import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Tag } from './api';
import Pressable from './HapticPressable';
import { objectCount } from './i18n';
import ScreenBottomSheet from './ScreenBottomSheet';
import TagRow from './TagRow';
import { searchTags, TagFilter } from './tag-search.model';
import { Button, Field, Icon, IconName, Notice, useUI } from './ui';

const filters: { key: TagFilter; name: string; icon: IconName }[] = [
  { key: 'all', name: 'Todos', icon: 'grid' },
  { key: 'active', name: 'Protegidos', icon: 'shield' },
  { key: 'lost', name: 'Perdidos', icon: 'search' },
  { key: 'paused', name: 'Pausados', icon: 'pause-circle' },
];

type Props = { tags: Tag[]; onSelect: (tag: Tag) => void; onClose: () => void; refreshing: boolean; onRefresh: () => void; error: string; covered: boolean };

export default function ObjectsScreen({ tags, onSelect, onClose, refreshing, onRefresh, error, covered }: Props) {
  const { C, s, t, locale } = useUI();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TagFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const list = useRef<FlatList<Tag>>(null);
  const filtered = useMemo(() => searchTags(tags, search, filter, t, locale), [tags, search, filter, t, locale]);
  const resetScroll = () => list.current?.scrollToOffset({ offset: 0, animated: false });
  const changeSearch = (value: string) => { setSearch(value); resetScroll(); };
  const close = () => { Keyboard.dismiss(); onClose(); };
  const requestClose = () => {
    if (filterOpen) setFilterOpen(false);
    else if (Keyboard.isVisible()) Keyboard.dismiss();
    else close();
  };

  return <Modal visible animationType="slide" onRequestClose={requestClose}>
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaView style={[styles.fill, { backgroundColor: C.bg }]}>
        <View style={styles.fill} accessibilityElementsHidden={filterOpen || covered} importantForAccessibility={filterOpen || covered ? 'no-hide-descendants' : 'auto'}>
          <View style={s.screenHeader}>
            <Button variant="ghost" icon="arrow-left" label={t('Voltar para início')} onPress={close} />
            <Text accessibilityRole="header" style={s.screenTitle}>{t('Objetos')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Filtrar objetos')} accessibilityState={{ selected: filter !== 'all' }}
              onPress={() => { Keyboard.dismiss(); setFilterOpen(true); }} style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}>
              <Icon name="sliders" size={26} />
              {filter !== 'all' && <View style={[styles.filterDot, { backgroundColor: C.accent }]} />}
            </Pressable>
          </View>
          <View style={styles.controls}>
            <View style={s.between}>
              <Text style={s.h2} accessibilityLiveRegion="polite">{objectCount(t, filtered.length, locale)}</Text>
              {filter !== 'all' && <Pressable accessibilityRole="button" accessibilityLabel={t('Limpar filtro')} onPress={() => { setFilter('all'); resetScroll(); }} style={({ pressed }) => [styles.activeFilter, { backgroundColor: C.secondary }, pressed && styles.pressed]}>
                <Text style={[s.small, { color: C.ink }]}>{t(filters.find(option => option.key === filter)!.name)}</Text><Icon name="x" size={16} />
              </Pressable>}
            </View>
            <View>
              <Field hideLabel label={t('Buscar objetos')} placeholder={t('Buscar por nome ou categoria')} value={search} onChangeText={changeSearch}
                autoCorrect={false} autoCapitalize="none" returnKeyType="search" onSubmitEditing={Keyboard.dismiss} style={styles.searchInput} />
              <View pointerEvents="none" style={styles.searchIcon}><Icon name="search" size={22} color={C.muted} /></View>
              {!!search && <View style={styles.clearSearch}><Button variant="ghost" icon="x" label={t('Limpar busca')} onPress={() => changeSearch('')} /></View>}
            </View>
            {!!error && <Notice error text={error} />}
          </View>
          <FlatList ref={list} data={filtered} keyExtractor={tag => tag.id} style={styles.fill} contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={12}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} />}
            renderItem={({ item }) => <TagRow tag={item} onPress={() => { Keyboard.dismiss(); onSelect(item); }} />}
            ListEmptyComponent={<View style={s.empty}>
              <View style={s.circle}><Icon name="search" size={28} color={C.muted} /></View>
              <Text style={[s.h2, styles.center]}>{t('Nenhum objeto por aqui')}</Text>
              <Text style={[s.body, styles.center]}>{t('Tente outro nome ou filtro para encontrar seu objeto.')}</Text>
              {(!!search || filter !== 'all') && <Button variant="secondary" onPress={() => { setSearch(''); setFilter('all'); Keyboard.dismiss(); resetScroll(); }}>{t('Limpar busca e filtros')}</Button>}
            </View>} />
        </View>
        {filterOpen && <ScreenBottomSheet title={t('Filtrar objetos')} onClose={() => setFilterOpen(false)}>
          <View>{filters.map(option => <Pressable key={option.key} accessibilityRole="radio" accessibilityLabel={t(option.name)} accessibilityState={{ checked: filter === option.key }}
            onPress={() => { setFilter(option.key); setFilterOpen(false); resetScroll(); }} style={({ pressed }) => [styles.filterRow, { borderBottomColor: C.line }, pressed && styles.pressed]}>
            <View style={s.settingsIcon}><Icon name={option.icon} size={20} /></View>
            <Text style={[s.body, { flex: 1, color: C.ink }]}>{t(option.name)}</Text>
            <Text style={s.small}>{(option.key === 'all' ? tags.length : tags.filter(tag => tag.status === option.key).length).toLocaleString(locale)}</Text>
            <View style={[styles.radio, { borderColor: C.line, backgroundColor: filter === option.key ? C.primary : 'transparent' }]}>
              {filter === option.key && <Icon name="check" size={16} color={C.onPrimary} />}
            </View>
          </Pressable>)}</View>
        </ScreenBottomSheet>}
      </SafeAreaView>
    </GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  controls: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, gap: 20, width: '100%', maxWidth: 600, alignSelf: 'center' },
  searchInput: { paddingLeft: 50, paddingRight: 52 },
  searchIcon: { position: 'absolute', left: 18, top: 0, bottom: 0, justifyContent: 'center' },
  clearSearch: { position: 'absolute', right: 4, top: 0, bottom: 0, justifyContent: 'center' },
  filterButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  filterDot: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4 },
  activeFilter: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 22 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 32, width: '100%', maxWidth: 600, alignSelf: 'center' },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.65 },
});
