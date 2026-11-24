import { AffaldOnlineAPI } from './affaldonline';
import { ProviderBase, ProviderContext } from './base';
import { AarhusAffaldAPI, InfovisionAPI, OdenseAffaldAPI, ProvasAPI, RenoSydAPI, VestForAPI } from './misc-json';
import { OpenExperienceAPI, OpenExperienceLiveAPI } from './openexp';
import { PerfectWasteAPI } from './perfectwaste';
import { RenowebghAPI } from './renoweb';
import {
  AffaldKKAPI, AffaldOnlinePdfAPI, AffaldOnlineWeb, AffaldWebAPI, IkastBrandeAPI, RenoDjursAPI, WasteWatchAPI,
} from './scrapers';

export type ProviderCtor = new (municipalityId: string | number, ctx: ProviderContext) => ProviderBase;

/**
 * api type (as in municipalities.json) -> implementation.
 * Upstream's deprecated 'nemaffald' (old København API) is not used by any municipality and not ported.
 */
export const PROVIDERS: Record<string, ProviderCtor> = {
  odense: OdenseAffaldAPI,
  aarhus: AarhusAffaldAPI,
  affaldkk: AffaldKKAPI,
  perfectwaste: PerfectWasteAPI,
  renoweb: RenowebghAPI,
  vestfor: VestForAPI,
  affaldonline: AffaldOnlineAPI,
  openexp: OpenExperienceAPI,
  openexplive: OpenExperienceLiveAPI,
  provas: ProvasAPI,
  renodjurs: RenoDjursAPI,
  renosyd: RenoSydAPI,
  wastewatch: WasteWatchAPI,
  herning: AffaldWebAPI,
  ikastbrande: IkastBrandeAPI,
  affaldonlineweb: AffaldOnlineWeb,
  affaldonlinepdf: AffaldOnlinePdfAPI,
  kolding: InfovisionAPI,
};
