import { alpaca } from './alpaca';
import { coinbase } from './coinbase';
import { demo } from './demo';
import type { DataProvider, ProviderId } from './provider';

export const PROVIDERS: DataProvider[] = [coinbase, alpaca, demo];

export function getProvider(id: ProviderId): DataProvider {
  return PROVIDERS.find((p) => p.id === id) ?? coinbase;
}
