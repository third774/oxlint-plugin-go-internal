import { eslintCompatPlugin } from '@oxlint/plugins';

import { boundaries } from './boundaries.ts';

const plugin = eslintCompatPlugin({
  meta: { name: 'go-internal' },
  rules: { boundaries },
});

export default plugin;
