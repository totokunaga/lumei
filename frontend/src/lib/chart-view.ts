// Remembers which view of the progress chart the user chose (BR-CHT-06), on
// the device, as the app language is.
import Storage from 'expo-sqlite/kv-store';
import { useState } from 'react';

/** The chart's views: the recent days, or the whole period. */
export type ChartView = 'recent' | 'period';

const KEY = 'lumei.chartView';

/**
 * Gets the chart view the user last chose, and a setter that remembers a new
 * one for next time (BR-CHT-06).
 * @returns The view, `'period'` until the user picks one, and its setter.
 */
export const useChartView = (): [ChartView, (view: ChartView) => void] => {
  const [view, setView] = useState<ChartView>(() =>
    Storage.getItemSync(KEY) === 'recent' ? 'recent' : 'period',
  );
  const choose = (next: ChartView) => {
    Storage.setItemSync(KEY, next);
    setView(next);
  };
  return [view, choose];
};
