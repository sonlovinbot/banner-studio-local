import { FeatureType } from '../types';

export type HistoryFeatureScope =
  | { include: FeatureType }
  | { excludeMany: FeatureType[] };

/** Feature type nào chỉ sống trong tab riêng, không lẫn vào "Tất cả".
 *
 *  - `mcp_banner`: sinh từ MCP bên ngoài, tách biệt với output trong app. */
export const OWN_TAB_ONLY: FeatureType[] = ['mcp_banner'];

export function historyFeatureScope(featureType: FeatureType | 'all'): HistoryFeatureScope {
  return featureType === 'all'
    ? { excludeMany: OWN_TAB_ONLY }
    : { include: featureType };
}
