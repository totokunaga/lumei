import { zodResolver } from '@hookform/resolvers/zod';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Animated, { FadeOut, ReduceMotion } from 'react-native-reanimated';
import { z } from 'zod';

import {
  amountToText,
  type CurrencyCode,
  formatAmountText,
  formatMoney,
  type Minor,
  parseAmount,
} from '@/domain/money';

import { AmountInput } from './amount-input';
import { CountingText } from './counting-text';
import { listLayout, riseIn } from './motion';
import { PressableScale } from './pressable-scale';
import { SetupStep } from './setup-step';
import { TextField } from './text-field';

/**
 * An item as the form returns it: amounts in minor units, an empty note as
 * null. `id` is the stored item's, kept through the form; unset for an item
 * added in it.
 */
export interface ListItem {
  id?: string;
  name: string;
  amount: Minor;
  note: string | null;
}

/** Props of `ItemListForm`. */
interface ItemListFormProps {
  title: string;
  description: string;
  addLabel: string;
  /** An example name for the first row, e.g. "Salary". */
  placeholder: string;
  /** Adds an optional note to each item, as fixed expenses have (BR-INC-02). */
  withNote: boolean;
  currency: CurrencyCode;
  initial: ListItem[];
  onSubmit: (items: ListItem[]) => void;
  /** Offers "Skip for now", as setup does; see `SetupStep`. */
  onSkip?: () => void;
  /** Opened from the confirm step to change the items; see `SetupStep`. */
  editing?: boolean;
  /** The primary button's label, e.g. "Save"; see `SetupStep`. */
  continueLabel?: string;
  /** Shows a close button; see `SetupStep`. */
  onClose?: () => void;
}

/** A row as typed: every field is text until the form is submitted. */
interface Row {
  /** The stored item's ID; empty for a row added in the form. */
  id: string;
  name: string;
  amount: string;
  note: string;
}

const emptyRow: Row = { id: '', name: '', amount: '', note: '' };

/**
 * Checks whether a row has nothing typed in it, so it can be left out rather
 * than rejected: the form always offers one row to fill in.
 * @returns True if every field is blank.
 */
const isBlank = (row: Row): boolean => !row.name.trim() && !row.amount.trim() && !row.note.trim();

/**
 * Builds the form's validation: each row that isn't blank needs a name and an
 * amount the currency allows, where 0 is allowed (BR-EXP-08, BR-INC-04). The
 * messages are translation keys under `setup.errors`.
 * @returns A Zod schema for the form's values.
 */
const formSchema = (currency: CurrencyCode) =>
  z.object({
    items: z.array(
      z
        .object({ id: z.string(), name: z.string(), amount: z.string(), note: z.string() })
        .superRefine((row, ctx) => {
          if (isBlank(row)) {
            return;
          }
          if (!row.name.trim()) {
            ctx.addIssue({ code: 'custom', path: ['name'], message: 'nameRequired' });
          }
          if (parseAmount(row.amount, currency, { allowZero: true }) === null) {
            ctx.addIssue({ code: 'custom', path: ['amount'], message: 'invalidAmount' });
          }
        }),
    ),
  });

/**
 * Renders a setup step that edits a list of named amounts, e.g. income or
 * fixed expenses (BR-INC-01, BR-INC-02): one card per item with a name, an
 * amount, and optionally a note, a button to add another, a remove button per
 * item, and the running total. Cards slide in when added and fade out when
 * removed. Continuing returns the filled-in items; blank rows are dropped.
 */
export function ItemListForm({
  title,
  description,
  addLabel,
  placeholder,
  withNote,
  currency,
  initial,
  onSubmit,
  onSkip,
  editing,
  continueLabel,
  onClose,
}: ItemListFormProps) {
  const { t, i18n } = useTranslation();
  const schema = useMemo(() => formSchema(currency), [currency]);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<{ items: Row[] }>({
    resolver: zodResolver(schema),
    defaultValues: {
      items:
        initial.length > 0
          ? initial.map((item) => ({
              id: item.id ?? '',
              name: item.name,
              amount: amountToText(item.amount, currency),
              note: item.note ?? '',
            }))
          : [emptyRow],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const rows = useWatch({ control, name: 'items' });

  const total = rows.reduce(
    (sum, row) => sum + (parseAmount(row.amount, currency, { allowZero: true }) ?? 0),
    0,
  );
  const example = amountToText(CURRENCY_EXAMPLE, currency);
  const exampleText = formatAmountText(example, i18n.language);

  const submit = handleSubmit(({ items }) =>
    onSubmit(
      items
        .filter((row) => !isBlank(row))
        .map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          amount: parseAmount(row.amount, currency, { allowZero: true }) ?? 0,
          note: row.note.trim() || null,
        })),
    ),
  );

  return (
    <SetupStep
      title={title}
      description={description}
      onContinue={() => void submit()}
      onSkip={onSkip}
      editing={editing}
      continueLabel={continueLabel}
      onClose={onClose}
      footer={
        <CountingText
          value={total}
          format={(amount) =>
            t('setup.items.total', { amount: formatMoney(amount, currency, i18n.language) })
          }
          className="pb-1 text-center text-base font-semibold text-gray-500 dark:text-gray-400"
        />
      }
    >
      {fields.map((field, index) => (
        <Animated.View
          key={field.id}
          entering={riseIn()}
          exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
          layout={listLayout}
          className="gap-2 rounded-3xl bg-gray-50 p-3 dark:bg-gray-950"
        >
          <View className="flex-row items-center gap-2">
            <Controller
              control={control}
              name={`items.${index}.name`}
              render={({ field: { value, onChange, onBlur }, fieldState }) => (
                <TextField
                  fontSize={18}
                  accessibilityLabel={t('setup.items.name')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder={index === 0 ? placeholder : t('setup.items.name')}
                  placeholderTextColor="#9CA3AF"
                  className={`h-14 flex-1 rounded-2xl border-2 bg-gray-100 px-4 text-black dark:bg-gray-900 dark:text-white ${
                    fieldState.error ? 'border-red-500' : 'border-transparent'
                  }`}
                />
              )}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={
                rows[index]?.name.trim()
                  ? t('setup.items.remove', { name: rows[index].name.trim() })
                  : t('setup.items.removeUnnamed')
              }
              onPress={() => remove(index)}
              className="h-11 w-11 items-center justify-center"
            >
              <SymbolView
                name={{ ios: 'minus.circle.fill', android: 'remove_circle' }}
                size={24}
                tintColor="#9CA3AF"
              />
            </PressableScale>
          </View>
          <Controller
            control={control}
            name={`items.${index}.amount`}
            render={({ field: { value, onChange, onBlur }, fieldState }) => (
              <AmountInput
                accessibilityLabel={t('setup.items.amount')}
                currency={currency}
                locale={i18n.language}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={example}
                invalid={!!fieldState.error}
              />
            )}
          />
          {withNote && (
            <Controller
              control={control}
              name={`items.${index}.note`}
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  accessibilityLabel={t('setup.items.note')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder={t('setup.items.note')}
                  placeholderTextColor="#9CA3AF"
                  className="h-12 rounded-2xl bg-gray-100 px-4 text-black dark:bg-gray-900 dark:text-white"
                />
              )}
            />
          )}
          {rowError(errors.items?.[index]) && (
            <Text accessibilityRole="alert" className="px-1 text-sm text-red-500">
              {t(`setup.errors.${rowError(errors.items?.[index])!}`, { example: exampleText })}
            </Text>
          )}
        </Animated.View>
      ))}

      <PressableScale
        accessibilityRole="button"
        onPress={() => append(emptyRow)}
        className="h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700"
      >
        <SymbolView name={{ ios: 'plus', android: 'add' }} size={18} tintColor="#10B981" />
        <Text className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
          {addLabel}
        </Text>
      </PressableScale>
    </SetupStep>
  );
}

/**
 * Picks the message to show under a row: the name's first, then the amount's.
 * @returns A key under `setup.errors`, or undefined when the row is valid.
 */
const rowError = (
  error: { name?: { message?: string }; amount?: { message?: string } } | undefined,
): 'nameRequired' | 'invalidAmount' | undefined =>
  (error?.name?.message ?? error?.amount?.message) as 'nameRequired' | 'invalidAmount' | undefined;

/** The example amount in error messages and placeholders, in minor units: 1234.56 or ¥123,456. */
const CURRENCY_EXAMPLE: Minor = 123_456;
