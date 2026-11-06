import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { Minor } from '@/domain/money';

import { CountingText } from './counting-text';
import { PressableScale } from './pressable-scale';

/** The period's items a summary row opens an editor for. */
export type EditableItem = 'income' | 'fixed-expenses' | 'target';

/** One row of a period's summary. */
export interface SummaryRow {
  label: string;
  value: Minor;
  format: (value: Minor) => string;
  /** The editor the row opens, if any. */
  edit?: EditableItem;
}

/**
 * Renders a period's summary as labelled rows, each counting to its new
 * value (BR-DSH-03, BR-HIS-02). Rows with an editor show a chevron and open
 * it. Each reads as one element to screen readers, e.g. "Income: ¥300,000"
 * (BR-NFR-07).
 */
export function SummaryRows({
  rows,
  onEdit,
}: {
  rows: SummaryRow[];
  onEdit: (item: EditableItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {rows.map((row) => {
        const label = t('home.labelled', { label: row.label, value: row.format(row.value) });
        const content = (
          <>
            <Text className="text-base text-gray-600 dark:text-gray-400">{row.label}</Text>
            <View className="flex-row items-center gap-2">
              <CountingText
                value={row.value}
                format={row.format}
                className={`text-base font-semibold ${
                  row.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-black dark:text-white'
                }`}
              />
              {row.edit && (
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right' }}
                  size={12}
                  tintColor="#9CA3AF"
                />
              )}
            </View>
          </>
        );
        const className =
          'flex-row items-center justify-between gap-4 border-t border-black/10 py-3 dark:border-white/10';
        const edit = row.edit;
        return edit ? (
          <PressableScale
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={t('home.editHint')}
            onPress={() => onEdit(edit)}
            className={className}
          >
            {content}
          </PressableScale>
        ) : (
          <View key={row.label} accessible accessibilityLabel={label} className={className}>
            {content}
          </View>
        );
      })}
    </>
  );
}
