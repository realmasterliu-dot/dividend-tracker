import { describe, expect, it } from 'vitest';
import type { TaxLot } from '@/types';
import { validateBackfillAmount } from '../DividendHistoryTable';
import { hongKongCustodyLabel, validateTaxOverrideAmount } from '../TaxBreakdownCard';
import { taxLotPresentation } from '../TaxLotTable';

const lot: TaxLot = {
  id: 'lot-1',
  instrumentId: '600519.SH',
  buyDate: '2025-01-01',
  originalBuyDate: '2025-01-01',
  quantity: 10,
  originalQuantity: 10,
  costPerShare: 100,
  costPerShareLocal: 100,
  sourceTxId: 'tx-1',
  events: [],
};

describe('详情金额输入校验', () => {
  it('实际到账拒绝空值和负数，但允许 0', () => {
    expect(validateBackfillAmount('').error).toContain('请输入');
    expect(validateBackfillAmount('-0.01').error).toContain('不能小于 0');
    expect(validateBackfillAmount('0')).toEqual({ value: 0 });
  });

  it('实际扣税拒绝空值和负数，但允许 0', () => {
    expect(validateTaxOverrideAmount('  ').error).toContain('请输入');
    expect(validateTaxOverrideAmount('-1').error).toContain('不能小于 0');
    expect(validateTaxOverrideAmount('0')).toEqual({ value: 0 });
  });
});

describe('详情税务文案', () => {
  it('港股本地券商与港股通显示各自税务口径', () => {
    expect(hongKongCustodyLabel('HK_LOCAL_BROKER')).toContain('0%');
    expect(hongKongCustodyLabel('HK_STOCK_CONNECT')).toContain('20%');
    expect(hongKongCustodyLabel('CN_BROKER')).toContain('未匹配');
  });

  it('持仓批次税档边界保持 30 天、365 天口径', () => {
    expect(taxLotPresentation(lot, '2025-01-31').bracket).toBe('20%');
    expect(taxLotPresentation(lot, '2025-02-01').bracket).toBe('10%');
    expect(taxLotPresentation(lot, '2026-01-01').bracket).toBe('免税');
  });
});
