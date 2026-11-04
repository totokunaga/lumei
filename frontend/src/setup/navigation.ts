import { type Href, useLocalSearchParams, useRouter } from 'expo-router';

/** What `useSetupFlow` returns. */
export interface SetupFlow {
  /** True when the step was opened from the confirm step to change one choice. */
  editing: boolean;
  /** Goes on to `href`, or back to the confirm step when editing. */
  next: (href: Href) => void;
}

/**
 * Tells a setup step where to go once its choice is made (BR-ACC-06). Steps
 * go one after another, but a step opened from the confirm step with
 * `editHref` goes straight back to it, where the change shows at once.
 * @returns Whether the step is being edited, and the function to go on.
 */
export const useSetupFlow = (): SetupFlow => {
  const router = useRouter();
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  return {
    editing,
    next: (href) => (editing ? router.back() : router.push(href)),
  };
};

/**
 * Builds the link to a setup step that edits one choice and comes back.
 * @returns e.g. `{ pathname: '/setup/income', params: { edit: '1' } }`.
 */
export const editHref = (pathname: SetupPath): Href => ({ pathname, params: { edit: '1' } });

/** The routes of the setup steps a user can edit from the confirm step. */
export type SetupPath =
  | '/setup'
  | '/setup/currency'
  | '/setup/start-day'
  | '/setup/income'
  | '/setup/fixed-expenses'
  | '/setup/target';
