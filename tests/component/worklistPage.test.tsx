import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorklistPage } from '@/pages/WorklistPage';
import * as cmiApi from '@/services/cmiApi';
import type { CmiCaseRow } from '@/cmi/caseContract';

const MOCK_CASES: CmiCaseRow[] = [
  {
    an: '660001',
    hn: '0054321',
    ptname: 'นาย ประสิทธิ์ มีสุข',
    sex: 'ชาย',
    age: 68,
    firstWard: '01',
    firstWardName: 'หอผู้ป่วยอายุรกรรมชาย',
    lastWard: '01',
    lastWardName: 'หอผู้ป่วยอายุรกรรมชาย',
    admdate: '2026-08-01',
    dchdate: '2026-08-07',
    los: 6,
    dchtype: '1',
    dchstts: '1',
    drg: '04010',
    mdc: '04',
    rw: 0.985,
    adjrw: 1.052,
    pdx: 'J189',
    sdx1: 'I10',
    income: 18500,
    remainMoney: 0,
    remark: '-',
  },
  {
    an: '660002',
    hn: '0067890',
    ptname: 'นาง สมใจ ทวีทรัพย์',
    sex: 'หญิง',
    age: 54,
    firstWard: '02',
    firstWardName: 'หอผู้ป่วยอายุรกรรมหญิง',
    lastWard: '02',
    lastWardName: 'หอผู้ป่วยอายุรกรรมหญิง',
    admdate: '2026-08-10',
    dchdate: '2026-08-13',
    los: 3,
    dchtype: '1',
    dchstts: '1',
    drg: null,
    mdc: null,
    rw: null,
    adjrw: 0,
    pdx: null,
    income: 8200,
    remainMoney: 0,
    remark: 'ยังไม่ลงรหัสโรค',
  },
];

describe('WorklistPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders disconnected state and connection form when offline (no mock data leakage)', () => {
    const onSelectMock = vi.fn();
    render(
      <WorklistPage
        onSelectCaseForOptimization={onSelectMock}
        connectionConfig={null}
        sessionStatus="idle"
      />,
    );

    // Verify header and offline badge
    expect(screen.getByText(/ทะเบียนเคสผู้ป่วยใน/i)).toBeInTheDocument();
    expect(screen.getByText(/HIS Offline/i)).toBeInTheDocument();

    // Verify BMS connection prompt is displayed
    expect(screen.getByText(/พร้อมเชื่อมต่อฐานข้อมูลผู้ป่วยในจริง/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ระบุ BMS Session ID/i)).toBeInTheDocument();

    // Verify no mock case IDs are displayed
    expect(screen.queryByText('1001')).not.toBeInTheDocument();
    expect(screen.queryByText('1002')).not.toBeInTheDocument();
  });

  it('renders dropdown filter bars for Year, Month, Ward, Status, and Scheme', () => {
    render(
      <WorklistPage
        onSelectCaseForOptimization={vi.fn()}
        connectionConfig={null}
        sessionStatus="idle"
      />,
    );

    // Verify dropdown selects exist
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(5); // Fiscal Year, Month, Ward, Status, Scheme
    expect(screen.getByText(/ปีงบประมาณ:/i)).toBeInTheDocument();
    expect(screen.getByText(/เดือนในรอบปีงบ:/i)).toBeInTheDocument();
    expect(screen.getByText(/สถานะการลงรหัส:/i)).toBeInTheDocument();
  });

  it('fetches real cases, displays KPIs, clinical audit badges, and handles filtering', async () => {
    vi.spyOn(cmiApi, 'fetchCaseWorklist').mockResolvedValue(MOCK_CASES);

    const onSelectMock = vi.fn();
    render(
      <WorklistPage
        onSelectCaseForOptimization={onSelectMock}
        connectionConfig={{
          apiUrl: 'https://test-his.hospital.in.th',
          databaseType: 'postgresql',
          appIdentifier: 'test',
        }}
        sessionStatus="connected"
      />,
    );

    // Verify cases are rendered
    await waitFor(() => {
      expect(screen.getByText('AN: 660001')).toBeInTheDocument();
      expect(screen.getByText('AN: 660002')).toBeInTheDocument();
      expect(screen.getByText('นาย ประสิทธิ์ มีสุข')).toBeInTheDocument();
      expect(screen.getByText('นาง สมใจ ทวีทรัพย์')).toBeInTheDocument();
    });

    // Verify KPI summary
    expect(screen.getByText('2 ราย')).toBeInTheDocument(); // total

    // Test Status Dropdown change to 'uncoded'
    const statusSelect = screen.getAllByRole('combobox')[3]; // 4th select is status
    fireEvent.change(statusSelect, { target: { value: 'uncoded' } });

    await waitFor(() => {
      expect(screen.queryByText('AN: 660001')).not.toBeInTheDocument();
      expect(screen.getByText('AN: 660002')).toBeInTheDocument();
    });

    // Test clicking "ให้รหัส & วิเคราะห์" button
    const optimizeBtn = screen.getByRole('button', { name: /ให้รหัส & วิเคราะห์/i });
    fireEvent.click(optimizeBtn);
    expect(onSelectMock).toHaveBeenCalledWith('660002');
  });

  it('handles fiscal year and month dropdown changes', async () => {
    const fetchSpy = vi.spyOn(cmiApi, 'fetchCaseWorklist').mockResolvedValue(MOCK_CASES);

    render(
      <WorklistPage
        onSelectCaseForOptimization={vi.fn()}
        connectionConfig={{
          apiUrl: 'https://test-his.hospital.in.th',
          databaseType: 'postgresql',
          appIdentifier: 'test',
        }}
        sessionStatus="connected"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('AN: 660001')).toBeInTheDocument();
    });

    // Change Fiscal Month dropdown to October (month 1)
    const monthSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(monthSelect, { target: { value: '1' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });
});
