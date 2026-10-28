/**
 * Requests to the helper's prospecting database (helper/engine/prospect.py): RIAs, exempt reporting advisers,
 * family offices and 13F managers built from free SEC data. The page that uses these comes in a later stage.
 */
import { clearEngineCache, engineRequest, type EngineEvent } from './schwab';

export type ProspectSource = 'adv' | 'adv_full' | '13f' | 'formd' | 'geo' | 'all';
export type FirmType = 'Registered RIA' | 'Exempt reporting adviser' | 'Likely family office' | 'Multi-family office' | 'Other 13F filer' | 'Form D issuer';
export type ClientType = 'individuals' | 'hnw' | 'banks' | 'investment_companies' | 'bdcs' | 'pooled' | 'pensions' | 'charities' | 'government' | 'other_advisers' | 'insurance' | 'sovereign' | 'corporations' | 'other';

export interface ProspectQuery {
  text?: string;
  type?: FirmType[];
  state?: string;
  city?: string;
  zip?: string;
  near?: { lat: number; lon: number; miles: number } | { zip: string; miles: number };
  aumMin?: number;
  aumMax?: number;
  clientTypes?: ClientType[];
  holds?: { symbol: string } | { cusip: string };
  minPosition?: number;
  has13f?: boolean;
  hasPrivateFunds?: boolean;
  sort?: 'aum' | 'name' | 'clients' | 'filed' | 'value13f' | 'funds' | 'distance' | 'position';
  limit?: number;
  offset?: number;
}

export interface ClientMixEntry { count: number | null; fewerThan5: boolean | null; aum: number | null }

export interface ProspectFirm {
  id: string;
  name: string;
  otherNames: string[];
  type: FirmType;
  /** 'from filing' for registry facts; family-office labels say 'strong/moderate/weak signals' (never certain). */
  confidence: string;
  reasons: string[];
  crd: number | null;
  secNumber: string | null;
  cik: number | null;
  street: string; city: string; state: string; zip: string; phone: string; website: string;
  aumTotal: number | null;
  aumDisc: number | null;
  clientsTotal: number | null;
  clientMix: Partial<Record<ClientType, ClientMixEntry>>;
  employees: number | null;
  fees: string[];
  filingDate: string;
  has13f: number;
  value13f: number | null;
  period13f: string | null;
  funds: number;
  fundsGav: number | null;
  offerings: number;
  lat: number | null;
  lon: number | null;
  geo: '' | 'address' | 'zip';
  distanceMiles?: number;
  position?: number;
}

export interface ProspectPosition {
  cusip: string; ticker: string | null; issuer: string; class: string; putCall: string;
  value: number; shares: number; weight: number;
  change: 'new' | 'added' | 'trimmed' | 'exited' | 'unchanged' | null;
  previousShares: number | null; previousValue: number | null; shareChange: number;
}

export interface ProspectProfile extends ProspectFirm {
  links: { source: string; sourceKey: string; method: string; score: number; status: 'linked' | 'possible'; name: string }[];
  aumHistory: { date: string; filed: string; aum: number | null; discretionary: number | null; clients: number | null; employees: number | null }[];
  people: { name: string; title: string; source: string; sourceRef: string; keyTitle: boolean; filed: string; ownership: string }[];
  privateFunds: { name: string; fundId: string; fundType: string; gav: number | null; owners: number | null; filed: string }[];
  formDOfferings: { accession: string; cik: number; name: string; fundType: string; filed: string; offering: number | null; sold: number | null; investors: number | null; minimum: number | null }[];
  holdings13f: {
    period: string | null; previousPeriod?: string | null; total?: number; count?: number;
    changes?: Record<string, number>; positions?: ProspectPosition[]; sectors?: Record<string, number>;
    turnover?: number | null; otherManagers?: { name: string; crd: number | null; secFile: string }[];
  };
  sources: { label: string; url: string }[];
}

export interface ProspectStatus {
  counts: Record<string, number>;
  types: Record<string, number>;
  sources: Record<string, ({ at: number; sourceDate?: string } & Record<string, unknown>) | null>;
  built: { at: number; firms: number; links: number } | null;
  job: { running: boolean; source?: string; stage?: string; started?: number; finished?: number; error?: string | null };
  progress: { stage: string; done: number; total: number; at: number } | null;
  sizeMb: number;
  /** Column check of each downloaded file (missing required = that source failed and nothing was saved). */
  headers: Record<string, { file: string; tables: string[]; missingRequired: string[]; missingOptional: string[]; unexpected: string[]; unexpectedCount: number }[] | null>;
  /** "People and private funds as of <date>": the SEC's bulk Form ADV data ended in Dec 2024. */
  peopleAsOf: string | null;
  peopleNote: string | null;
}

export const prospectStatus = () => engineRequest<ProspectStatus>('prospect.status', {}, 20000);

/** Starts a download in the background (watch prospectStatus), or waits for it with progress events. */
export async function prospectIngest(source: ProspectSource, onEvent?: (e: EngineEvent) => void) {
  const reply = await engineRequest<Record<string, unknown>>('prospect.ingest', { source, wait: Boolean(onEvent) }, onEvent ? 4 * 3600_000 : 20000, onEvent);
  clearEngineCache('prospect.');
  return reply;
}

export const prospectSearch = (query: ProspectQuery) => engineRequest<{ total: number; rows: ProspectFirm[]; note?: string; centre?: { lat: number; lon: number } }>('prospect.search', { ...query }, 60000);
// 'id' is reserved in helper messages, so the firm goes as firmId.
export const prospectFirm = (firmId: string) => engineRequest<ProspectProfile>('prospect.firm', { firmId }, 90000);
export const prospectCompare = (ids: string[]) => engineRequest<Record<string, unknown>>('prospect.compare', { ids }, 90000);
export const prospectExport = (query: ProspectQuery) => engineRequest<{ csv: string; count: number; total: number; columns: string[] }>('prospect.export', { query }, 120000);
