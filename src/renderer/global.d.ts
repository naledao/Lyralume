import type { LyralumeApi } from '../shared/contracts';

declare global {
  interface Window {
    lyralume: LyralumeApi;
  }
}

export {};
