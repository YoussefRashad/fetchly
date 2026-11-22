import type { FetchlyApi } from '../../shared/types';

declare global {
  interface Window {
    fetchly: FetchlyApi;
  }
}

export {};
