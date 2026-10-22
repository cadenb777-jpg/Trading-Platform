import { alpaca } from './alpaca';
import { coinbase } from './coinbase';
import { demo } from './demo';
import type { DataProvider, ProviderId } from './provider';
import { schwab } from './schwab';

export const PROVIDERS: DataProvider[] = [coinbase, schwab, alpaca, demo];

export function getProvider(id: ProviderId): DataProvider {
  return PROVIDERS.find((p) => p.id === id) ?? coinbase;
}
