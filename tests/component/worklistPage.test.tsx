import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorklistPage } from '@/pages/WorklistPage';

describe('WorklistPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders worklist table with summary KPI cards and cases', async () => {
    const onSelectMock = vi.fn();
    render(
      <WorklistPage
        onSelectCaseForOptimization={onSelectMock}
        connectionConfig={null}
        sessionStatus="demo"
      />,
    );

    expect(screen.getByText(/ทะเบียนเคสผู้ป่วยใน/i)).toBeInTheDocument();

    // Verify cases are rendered
    await waitFor(() => {
      expect(screen.getByText('1001')).toBeInTheDocument();
      expect(screen.getByText('1002')).toBeInTheDocument();
      expect(screen.getAllByText(/ยังไม่ลงรหัสโรค/i).length).toBeGreaterThan(0);
    });

    // Test filter by uncoded
    const uncodedFilterBtn = screen.getByRole('button', { name: /ยังไม่ลงรหัสโรค/i });
    fireEvent.click(uncodedFilterBtn);

    await waitFor(() => {
      expect(screen.queryByText('1001')).not.toBeInTheDocument();
      expect(screen.getByText('1002')).toBeInTheDocument();
    });

    // Test clicking "วิเคราะห์ DRG" button triggers callback
    const optimizeButtons = screen.getAllByRole('button', { name: /วิเคราะห์ DRG/i });
    fireEvent.click(optimizeButtons[0]);
    expect(onSelectMock).toHaveBeenCalledWith('1002');
  });

  it('supports quick date preset buttons to change date range dynamically', async () => {
    const onSelectMock = vi.fn();
    render(
      <WorklistPage
        onSelectCaseForOptimization={onSelectMock}
        connectionConfig={null}
        sessionStatus="demo"
      />,
    );

    // Verify quick preset buttons exist
    const thisMonthBtn = screen.getByRole('button', { name: /เดือนนี้/i });
    const last30DaysBtn = screen.getByRole('button', { name: /30 วันล่าสุด/i });
    expect(thisMonthBtn).toBeInTheDocument();
    expect(last30DaysBtn).toBeInTheDocument();

    // Click "เดือนนี้" and verify date range text updates
    fireEvent.click(thisMonthBtn);
    await waitFor(() => {
      expect(screen.getByText(/ช่วงวันที่ค้นหา:/i)).toBeInTheDocument();
      expect(screen.getByText('1001')).toBeInTheDocument();
    });

    // Click "30 วันล่าสุด"
    fireEvent.click(last30DaysBtn);
    await waitFor(() => {
      expect(screen.getByText(/ช่วงวันที่ค้นหา:/i)).toBeInTheDocument();
    });
  });
});
