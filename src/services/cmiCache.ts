import type { CmiCaseRow, UsageLite, CasePageResult } from '@/cmi/caseContract';

/**
 * In-Memory Zero-Leak Cache for CMI & HIS Queries
 *
 * Security Principles:
 * 1. 100% Volatile Memory: NEVER persisted to localStorage, sessionStorage, IndexedDB, or cookies.
 * 2. Tenant/Session Scoped: Cache keys are prefixed by hospitalCode + session hash to prevent data leakage between sessions.
 * 3. Bounded & TTL Expiring: Entries expire after a short TTL and are LRU-evicted when limits are reached.
 * 4. Auto-Destroy: When a user disconnects or an error occurs, all data is immediately cleared.
 */

export const CASE_DETAIL_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const USAGE_ITEMS_TTL_MS = 5 * 60 * 1000;  // 5 minutes
export const WORKLIST_PAGE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export const MAX_CASE_DETAIL_ENTRIES = 100;
export const MAX_USAGE_ITEMS_ENTRIES = 100;
export const MAX_WORKLIST_PAGE_ENTRIES = 30;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const caseDetailMap = new Map<string, CacheEntry<CmiCaseRow>>();
const usageItemsMap = new Map<string, CacheEntry<UsageLite[]>>();
const worklistPageMap = new Map<string, CacheEntry<CasePageResult>>();

function isExpired<T>(entry: CacheEntry<T> | undefined): boolean {
  if (!entry) return true;
  return Date.now() > entry.expiresAt;
}

function evictOldest<T>(map: Map<string, CacheEntry<T>>, maxEntries: number): void {
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey) map.delete(oldestKey);
    else break;
  }
}

export function getCachedCaseDetail(an: string, scope: string): CmiCaseRow | null {
  const key = `${scope}:case:${an}`;
  const entry = caseDetailMap.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    caseDetailMap.delete(key);
    return null;
  }
  // Refresh recency
  caseDetailMap.delete(key);
  caseDetailMap.set(key, entry);
  return entry.data;
}

export function setCachedCaseDetail(an: string, scope: string, data: CmiCaseRow, ttlMs = CASE_DETAIL_TTL_MS): void {
  const key = `${scope}:case:${an}`;
  evictOldest(caseDetailMap, MAX_CASE_DETAIL_ENTRIES);
  caseDetailMap.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function getCachedUsageItems(an: string, scope: string, pageSize: number): UsageLite[] | null {
  const key = `${scope}:usage:${an}:${pageSize}`;
  const entry = usageItemsMap.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    usageItemsMap.delete(key);
    return null;
  }
  usageItemsMap.delete(key);
  usageItemsMap.set(key, entry);
  return entry.data;
}

export function setCachedUsageItems(an: string, scope: string, pageSize: number, data: UsageLite[], ttlMs = USAGE_ITEMS_TTL_MS): void {
  const key = `${scope}:usage:${an}:${pageSize}`;
  evictOldest(usageItemsMap, MAX_USAGE_ITEMS_ENTRIES);
  usageItemsMap.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function getCachedWorklistPage(queryKey: string, scope: string): CasePageResult | null {
  const key = `${scope}:page:${queryKey}`;
  const entry = worklistPageMap.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    worklistPageMap.delete(key);
    return null;
  }
  worklistPageMap.delete(key);
  worklistPageMap.set(key, entry);
  return entry.data;
}

export function setCachedWorklistPage(queryKey: string, scope: string, data: CasePageResult, ttlMs = WORKLIST_PAGE_TTL_MS): void {
  const key = `${scope}:page:${queryKey}`;
  evictOldest(worklistPageMap, MAX_WORKLIST_PAGE_ENTRIES);
  worklistPageMap.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Invalidate cached entries for a specific AN across all scopes, or within a specific scope.
 */
export function invalidateCaseCache(an: string, scope?: string): void {
  const anSuffix = `:case:${an}`;
  const usageSuffix = `:usage:${an}:`;
  for (const key of [...caseDetailMap.keys()]) {
    if ((!scope || key.startsWith(`${scope}:`)) && key.endsWith(anSuffix)) {
      caseDetailMap.delete(key);
    }
  }
  for (const key of [...usageItemsMap.keys()]) {
    if ((!scope || key.startsWith(`${scope}:`)) && key.includes(usageSuffix)) {
      usageItemsMap.delete(key);
    }
  }
}

/**
 * Wipes all cached queries immediately from memory.
 * Must be called whenever a session disconnects, expires, or changes.
 */
export function clearCmiCache(): void {
  caseDetailMap.clear();
  usageItemsMap.clear();
  worklistPageMap.clear();
}

export function getCmiCacheStats(): { caseDetails: number; usageItems: number; worklistPages: number } {
  return {
    caseDetails: caseDetailMap.size,
    usageItems: usageItemsMap.size,
    worklistPages: worklistPageMap.size,
  };
}
