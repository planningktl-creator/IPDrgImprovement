import type { UsageLite } from '@/cmi/caseContract';

export interface DxCandidate {
  code: string;
  source: 'presc_reason' | 'need_order_reason' | 'coder_manual' | 'existing_sdx';
  evidence: string[];
}

// Matches ICD-10 codes with or without dot (e.g. A41, A419, A41.9, E11.9, J189)
const CODE_RE = /\b[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4}|[0-9A-Z]{1,2})?\b/g;

export const cleanIcdCode = (s: string): string =>
  s.trim().toUpperCase().replace(/\./g, '').replace(/[^A-Z0-9]/g, '');

/**
 * Extracts candidate ICD-10 diagnosis codes from itemized patient usage,
 * associating each code with its documented prescription/order reasons and hospital GUID evidence.
 */
export function extractCandidates(items: UsageLite[]): DxCandidate[] {
  const map = new Map<string, DxCandidate>();

  for (const it of items) {
    const fields: Array<['presc_reason' | 'need_order_reason', string | null | undefined]> = [
      ['presc_reason', it.prescReason],
      ['presc_reason', it.prescReason2],
      ['presc_reason', it.prescReason3],
      ['presc_reason', it.prescReason4],
      ['presc_reason', it.prescReason5],
      ['need_order_reason', it.needOrderReason],
    ];

    for (const [src, raw] of fields) {
      if (!raw) continue;
      const matches = String(raw).toUpperCase().match(CODE_RE) ?? [];
      for (const m of matches) {
        const c = cleanIcdCode(m);
        if (c.length < 3) continue;

        const cur = map.get(c) ?? {
          code: c,
          source: src,
          evidence: [],
        };

        const itemDesc = it.itemName ? ` (${it.itemName.slice(0, 40)})` : '';
        const guidDesc = it.hosGuid ? ` [${it.hosGuid}]` : '';
        const evidenceStr = `${src}: ${String(raw).trim().slice(0, 80)}${itemDesc}${guidDesc}`;

        if (!cur.evidence.includes(evidenceStr)) {
          cur.evidence.push(evidenceStr);
        }
        map.set(c, cur);
      }
    }
  }

  return [...map.values()];
}
