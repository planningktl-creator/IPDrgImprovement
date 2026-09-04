import {
  buildDrgPayload,
  calculateDrg,
  type DrgCaseInput,
} from '@/drg/grouperClient';

export interface Suggestion {
  kind: 'add_sdx' | 'swap_pdx' | 'add_proc';
  pdx: string;
  sdx: string[];
  proc: string[];
  drg: string;
  adjrw: number | null;
  delta: number | null;
  reason: string;
  warning?: string;
  evidence?: string[];
  rw?: number;
  mdc?: string;
}

export interface BaselineResult {
  drg: string;
  adjrw: number | null;
  rw?: number;
  mdc?: string;
  wtlos?: number;
  ot?: number;
  error?: string;
  warning?: string;
}

export interface SuggestFailure {
  kind: Suggestion['kind'];
  code: string;
  message: string;
}

export interface SuggestProgress {
  completed: number;
  total: number;
  phase: 'baseline' | 'candidate' | 'complete';
  label?: string;
}

export type CandidateInput =
  | string
  | {
      code: string;
      reason?: string;
      evidence?: string[];
    };

export interface SuggestOptions {
  concurrency?: number;
  signal?: AbortSignal;
  maxCandidates?: number;
  onProgress?: (progress: SuggestProgress) => void;
}

export interface SuggestResult {
  baseline: BaselineResult;
  suggestions: Suggestion[];
  failures: SuggestFailure[];
  cancelled: boolean;
}

/**
 * Executes a baseline Grouper calculation and evaluates permutations (adding evidenced secondary
 * diagnoses, swapping primary diagnosis) to identify adjustments that yield a higher DRG / AdjRW.
 */
export async function suggestHigherDrg(
  base: DrgCaseInput,
  candidates: CandidateInput[],
  opts: SuggestOptions = {},
): Promise<SuggestResult> {
  opts.onProgress?.({ completed: 0, total: 1, phase: 'baseline', label: 'กำลังคำนวณ Baseline DRG' });
  const bJson = await calculateDrg(buildDrgPayload(base), opts.signal);
  const b = bJson.data[0];
  const baseAdj = typeof b.adjrw === 'number' ? b.adjrw : null;

  const baseline: BaselineResult = {
    drg: String(b.drg ?? ''),
    adjrw: baseAdj,
    rw: typeof b.rw === 'number' ? b.rw : undefined,
    mdc: b.mdc ? String(b.mdc) : undefined,
    wtlos: typeof b.wtlos === 'number' ? b.wtlos : undefined,
    ot: typeof b.ot === 'number' ? b.ot : undefined,
    error: b.err ? String(b.err) : undefined,
    warning: b.warn ? String(b.warn) : undefined,
  };

  // Normalize candidate list
  const candidateMap = new Map<string, { code: string; reason?: string; evidence?: string[] }>();
  for (const item of candidates) {
    const code = typeof item === 'string' ? item.trim().toUpperCase() : item.code.trim().toUpperCase();
    if (!code || code === base.pdx) continue;
    if (!candidateMap.has(code)) {
      candidateMap.set(code, {
        code,
        reason: typeof item === 'string' ? undefined : item.reason,
        evidence: typeof item === 'string' ? undefined : item.evidence,
      });
    }
  }

  const requestedMaxCandidates = opts.maxCandidates ?? 20;
  if (!Number.isFinite(requestedMaxCandidates) || requestedMaxCandidates < 1) throw new Error('จำนวน candidate ต้องมากกว่า 0');
  const maxCandidates = Math.min(30, Math.trunc(requestedMaxCandidates));
  const targetCandidates = [...candidateMap.values()].slice(0, maxCandidates);

  interface MutationItem {
    kind: Suggestion['kind'];
    pdx: string;
    sdx: string[];
    proc: string[];
    reason: string;
    evidence?: string[];
  }

  const queue: MutationItem[] = [];

  for (const c of targetCandidates) {
    const isAlreadySdx = base.sdx.includes(c.code);

    if (!isAlreadySdx) {
      if (base.sdx.length < 12) {
        queue.push({
          kind: 'add_sdx',
          pdx: base.pdx,
          sdx: [...base.sdx, c.code],
          proc: base.proc,
          reason: c.reason || `พบ ${c.code} ในหลักฐานการใช้ยา/เวชภัณฑ์ (presc/need_order_reason)`,
          evidence: c.evidence,
        });
      }

      queue.push({
        kind: 'swap_pdx',
        pdx: c.code,
        sdx: [base.pdx, ...base.sdx.filter((x) => x !== c.code)].slice(0, 12),
        proc: base.proc,
        reason: `ลองสลับ ${c.code} เป็น PDx (เดิม ${base.pdx} ปรับเป็น SDx)`,
        evidence: c.evidence,
      });
    } else {
      queue.push({
        kind: 'swap_pdx',
        pdx: c.code,
        sdx: [base.pdx, ...base.sdx.filter((x) => x !== c.code)].slice(0, 12),
        proc: base.proc,
        reason: `สลับ SDx ${c.code} ที่มีอยู่แล้วขึ้นเป็น PDx (เดิม ${base.pdx} เป็น SDx)`,
        evidence: c.evidence,
      });
    }
  }

  const out: Suggestion[] = [];
  const failures: SuggestFailure[] = [];
  const total = queue.length;
  let completed = 0;
  let cancelled = false;

  // Sequential execution to respect MOPH Grouper API rate limits
  for (const q of queue) {
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }

    try {
      const j = await calculateDrg(
        buildDrgPayload({
          ...base,
          pdx: q.pdx,
          sdx: q.sdx,
          proc: q.proc,
        }),
        opts.signal,
      );

      const r = j.data[0];
      const a = typeof r.adjrw === 'number' ? r.adjrw : null;
      const delta =
        a != null && baseAdj != null ? +(a - baseAdj).toFixed(4) : null;

      const warningParts: string[] = [];
      if (r.err) warningParts.push(`error: ${r.err}`);
      if (r.warn) warningParts.push(`warn: ${r.warn}`);

      out.push({
        kind: q.kind,
        pdx: q.pdx,
        sdx: q.sdx,
        proc: q.proc,
        drg: String(r.drg ?? ''),
        adjrw: a,
        delta,
        reason: q.reason,
        evidence: q.evidence,
        rw: typeof r.rw === 'number' ? r.rw : undefined,
        mdc: r.mdc ? String(r.mdc) : undefined,
        warning: warningParts.length > 0 ? warningParts.join(' ') : undefined,
      });
    } catch (error) {
      if (opts.signal?.aborted) {
        cancelled = true;
        break;
      }
      failures.push({ kind: q.kind, code: q.pdx, message: error instanceof Error ? error.message : 'Grouper calculation failed' });
    } finally {
      completed += 1;
      opts.onProgress?.({ completed, total, phase: 'candidate', label: `${completed}/${total} candidate` });
    }
  }

  const positiveSuggestions = out
    .filter((s) => s.delta != null && s.delta > 0)
    .sort((x, y) => (y.delta ?? 0) - (x.delta ?? 0));

  cancelled = cancelled || Boolean(opts.signal?.aborted);
  opts.onProgress?.({ completed, total, phase: 'complete', label: cancelled ? 'ยกเลิกการคำนวณแล้ว' : 'คำนวณเสร็จแล้ว' });
  return {
    baseline,
    suggestions: positiveSuggestions,
    failures,
    cancelled,
  };
}
