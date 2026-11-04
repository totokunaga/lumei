import { useAuth } from '@/auth/store';
import { useSetupDraft } from '@/setup/draft';
import { finishSetup } from '@/setup/finish';

import { storedSessionFor } from '../helpers/api';
import { japanSet } from '../helpers/category-sets';

describe('finishSetup (BR-ACC-06)', () => {
  beforeEach(() => useSetupDraft.getState().reset());

  it.each([
    { name: 'the region', signedIn: true, draft: { currency: 'JPY' as const } },
    { name: 'the currency', signedIn: true, draft: { set: japanSet } },
    { name: 'a signed-in user', signedIn: false, draft: { set: japanSet, currency: 'JPY' as const } },
  ])('refuses to save without $name', ({ signedIn, draft }) => {
    useAuth.setState({ status: signedIn ? 'signedIn' : 'signedOut', session: signedIn ? storedSessionFor() : null });
    useSetupDraft.setState(draft);

    expect(() => finishSetup()).toThrow('Setup needs a signed-in user, a region, and a currency');
  });
});
