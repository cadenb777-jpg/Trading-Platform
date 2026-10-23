/** Saved documents (portfolios, clients, branding) live in the helper's database on your computer. */
import { engineRequest } from './schwab';

export type Collection = 'portfolios' | 'clients' | 'branding' | 'alt_holdings';

export async function listDocs<T>(collection: Collection): Promise<(T & { id: string })[]> {
  return (await engineRequest<{ docs: (T & { id: string })[] }>('store.list', { collection })).docs;
}

export async function saveDoc<T extends { id?: string }>(collection: Collection, doc: T): Promise<T & { id: string }> {
  return (await engineRequest<{ doc: T & { id: string } }>('store.save', { collection, doc })).doc;
}

export async function deleteDoc(collection: Collection, id: string): Promise<void> {
  await engineRequest('store.delete', { collection, docId: id });
}
