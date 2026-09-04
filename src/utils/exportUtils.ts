import * as XLSX from 'xlsx';
import type { CmiCaseRow } from '@/cmi/caseContract';

export interface ExportableCaseRow {
  AN: string;
  HN: string;
  ผู้ป่วย: string;
  หอผู้ป่วย: string;
  วันจำหน่าย: string;
  LOS: number | string;
  PDx: string;
  SDx: string;
  Procedures: string;
  DRG: string;
  AdjRW: number | string;
  สถานะ: string;
}

export function toExportRows(rows: CmiCaseRow[]): ExportableCaseRow[] {
  return rows.map((row) => ({
    AN: row.an ?? '',
    HN: row.hn ?? '',
    ผู้ป่วย: row.ptname ?? '',
    หอผู้ป่วย: row.firstWardName ?? row.lastWardName ?? row.firstWard ?? '',
    วันจำหน่าย: row.dchdate ?? '',
    LOS: row.los ?? '',
    PDx: row.pdx ?? '',
    SDx: row.sdx?.join(', ') ?? [row.sdx1, row.sdx2, row.sdx3, row.sdx4, row.sdx5, row.sdx6, row.sdx7, row.sdx8, row.sdx9, row.sdx10, row.sdx11, row.sdx12].filter(Boolean).join(', '),
    Procedures: row.proc?.join(', ') ?? [row.proc1, row.proc2, row.proc3, row.proc4, row.proc5, row.proc6, row.proc7, row.proc8, row.proc9, row.proc10, row.proc11, row.proc12].filter(Boolean).join(', '),
    DRG: row.drg ?? '',
    AdjRW: row.adjrw ?? '',
    สถานะ: row.remark ?? '-',
  }));
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadCasesCsv(rows: CmiCaseRow[], filename = 'iptimprove-worklist.csv'): void {
  const data = toExportRows(rows);
  const worksheet = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadCasesXlsx(rows: CmiCaseRow[], filename = 'iptimprove-worklist.xlsx'): void {
  const data = toExportRows(rows);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 8 },
    { wch: 12 }, { wch: 36 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Worklist');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
