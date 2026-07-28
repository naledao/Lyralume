// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { shouldUsePackagedResources } from './runtime-mode';

describe('runtime mode detection', () => {
  it('keeps a branded development host on project resources', () => {
    expect(shouldUsePackagedResources(true, 'http://127.0.0.1:5173')).toBe(false);
  });

  it('uses packaged resources only for an installed build without a dev server', () => {
    expect(shouldUsePackagedResources(true, undefined)).toBe(true);
    expect(shouldUsePackagedResources(false, undefined)).toBe(false);
  });
});
