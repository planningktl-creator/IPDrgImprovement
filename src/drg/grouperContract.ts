/**
 * Official MOPH DRG Grouper Contract Definitions
 *
 * Base Endpoint: https://had-api.moph.go.th/cmi
 * Calculation Endpoint: POST https://had-api.moph.go.th/cmi/drg/calculate
 * Version: '6' (TGrp6305 v6.3.5)
 *
 * Rules:
 * - hcode: 5 numeric digits (e.g. 10929 for Kantharalak Hospital)
 * - pdx: Required primary diagnosis code (alphanumeric, no dots)
 * - sdx: Array of secondary diagnoses, MAX_SDX = 12
 * - proc: Array of procedure codes, MAX_PROC = 30
 * - age: 0-120 (integer)
 * - age_day: 0-364 (integer)
 * - weight: 0-300 (numeric kg)
 * - los_day: 0-9999 (integer)
 * - los_hour: 0-23 (integer)
 * - baseRate: 0 - 10,000,000
 *
 * Security Notice:
 * - Direct fetch ONLY for POST /drg/calculate.
 * - NEVER route patient case data through public CORS proxies or third-party gateways.
 * - Proxy fallbacks are permitted ONLY for GET /libs/* metadata dictionaries.
 *
 * Network Constraint:
 * - The MOPH API is restricted to Thai IP addresses (foreign IPs return 404 / connection rejected).
 */

export const DRG_API_BASE = 'https://had-api.moph.go.th/cmi';
export const DRG_VERSION = '6';
export const MAX_SDX = 12;
export const MAX_PROC = 30;
export const MAX_PERMUTE_CODES = 30;
export const DEFAULT_HCODE = '10929';

export interface DrgItemPayload {
  hcode: string;
  hn: string;
  an: string;
  sex: 1 | 2;
  age: number;
  age_day: number;
  los_day: number;
  los_hour: number;
  weight: number;
  dischs: string;
  discht: string;
  pdx: string;
  sdx: string[];
  proc: string[];
}

export interface DrgCalculationRequest {
  version: string;
  data: DrgItemPayload[];
}

export interface DrgCalculationResultRow {
  drg: string;
  mdc?: string;
  rw?: number;
  adjrw?: number;
  wtlos?: number;
  ot?: number;
  err?: string;
  warn?: string;
  pccl?: number;
}

export interface DrgCalculationResponse {
  status: number;
  data: DrgCalculationResultRow[];
  tgrp?: unknown;
}
