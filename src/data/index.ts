import { coinbase } from './coinbase';
import type { DataProvider, ProviderId } from './provider';
import { schwab } from './schwab';

export const PROVIDERS: DataProvider[] = [coinbase, schwab];

export function getProvider(id: ProviderId): DataProvider {
  return PROVIDERS.find((p) => p.id === id) ?? coinbase;
}
