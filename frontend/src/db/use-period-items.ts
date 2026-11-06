// Reads a period's editable items for the screens that edit them.
import { useMemo } from 'react';

import type { CurrencyCode } from '@/domain/money';

import { useDataVersion } from './changes';
import { database } from './client';
import { type PeriodItems, readPeriodItems, readSettings } from './records';

/**
 * Reads a period's income, fixed expenses, and saving target, and the
 * account currency, again after every write.
 * @returns The items, or null if there is no such period.
 */
export const usePeriodItems = (
  periodId: string,
): { items: PeriodItems | null; currency: CurrencyCode } => {
  const version = useDataVersion();
  return useMemo(() => {
    const db = database();
    return {
      items: readPeriodItems(db, periodId),
      currency: (readSettings(db)?.currency ?? 'USD') as CurrencyCode,
    };
    // `version` changes with every write, so the items are read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, version]);
};
