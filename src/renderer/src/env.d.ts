import type { HammelApi } from '../../shared/types';

declare global {
  interface Window {
    hammel: HammelApi;
  }
}

export {};
