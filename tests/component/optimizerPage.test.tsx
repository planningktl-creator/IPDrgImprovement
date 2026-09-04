import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OptimizerPage } from '@/pages/OptimizerPage';
import * as cmiApi from '@/services/cmiApi';
import * as grouperClient from '@/drg/grouperClient';

describe('OptimizerPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders search input and safety disclaimer banner', () => {
    render(<OptimizerPage />);

    expect(screen.getByPlaceholderText(/AN/i)).toBeInTheDocument();
    expect(screen.getByText(/ข้อเสนอแนะเพื่อทบทวนโดย coder เท่านั้น/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /โหลดเคส/i })).toBeInTheDocument();
  });

  it('loads case, calculates baseline, and renders ranked suggestions table', async () => {
    // Mock case detail
    vi.spyOn(cmiApi, 'fetchCaseDetail').mockResolvedValue({
      an: '1001',
      hn: '0054321',
      ptname: 'นาย ประสิทธิ์ มีสุข',
      sex: 'ชาย',
      age: 68,
      los: 6,
      dchtype: '1',
      dchstts: '1',
      drg: '04010',
      mdc: '04',
      rw: 0.985,
      adjrw: 1.052,
      pdx: 'J189',
      sdx1: 'I10',
      sdx2: null,
      sdx3: null,
      sdx4: null,
      extCause: null,
      proc1: '9914',
      proc2: null,
      proc3: null,
    });

    // Mock usage items with evidence
    vi.spyOn(cmiApi, 'fetchUsageItems').mockResolvedValue([
      {
        hosGuid: 'GUID-1',
        an: '1001',
        icode: '1500010',
        itemName: 'Meropenem 1g inj',
        needOrderReason: 'Severe sepsis A419',
        prescReason: 'A419',
        prescReason2: null,
        prescReason3: null,
        prescReason4: null,
        prescReason5: null,
      },
    ]);

    // Mock grouper calculation
    vi.spyOn(grouperClient, 'calculateDrg').mockImplementation(async (payload: unknown) => {
      const p = payload as { data: Array<{ pdx: string; sdx: string[] }> };
      const item = p.data[0];

      // Baseline: pdx=J189
      if (item.pdx === 'J189' && !item.sdx.includes('A419')) {
        return {
          status: 200,
          data: [{ drg: '04010', adjrw: 1.052, rw: 0.985, mdc: '04' }],
        };
      }

      // Add SDx A419 -> adjrw 1.8
      if (item.pdx === 'J189' && item.sdx.includes('A419')) {
        return {
          status: 200,
          data: [{ drg: '04011', adjrw: 1.85, rw: 1.6, mdc: '04' }],
        };
      }

      // Swap PDx A419 -> adjrw 2.85
      if (item.pdx === 'A419') {
        return {
          status: 200,
          data: [{ drg: '18010', adjrw: 2.85, rw: 2.5, mdc: '18' }],
        };
      }

      return {
        status: 200,
        data: [{ drg: '04010', adjrw: 1.052 }],
      };
    });

    render(
      <OptimizerPage
        initialAn="1001"
        externalStatus="connected"
        externalConfig={{
          apiUrl: 'https://test.bms.in.th',
          databaseType: 'postgresql',
          appIdentifier: 'test',
        }}
      />,
    );

    // Wait for fetchCaseDetail to be called
    await waitFor(() => {
      expect(cmiApi.fetchCaseDetail).toHaveBeenCalled();
      expect(cmiApi.fetchUsageItems).toHaveBeenCalled();
      expect(grouperClient.calculateDrg).toHaveBeenCalled();
    });

    // Wait for baseline to appear
    await waitFor(() => {
      expect(screen.getByText(/ประสิทธิ์/i)).toBeInTheDocument();
      expect(screen.getAllByText('J189').length).toBeGreaterThan(0);
    });

    // Verify suggestions table contains the ranked items
    await waitFor(() => {
      expect(screen.getByText('18010')).toBeInTheDocument();
      expect(screen.getByText('+1.7980')).toBeInTheDocument(); // 2.85 - 1.052 = 1.798
      expect(screen.getByText(/ระบบตรวจสอบความถูกต้องของรหัสโรคและเกณฑ์ DRG/i)).toBeInTheDocument();
      expect(screen.getByText(/คะแนนคุณภาพการให้รหัส/i)).toBeInTheDocument();
    });
  });
});
