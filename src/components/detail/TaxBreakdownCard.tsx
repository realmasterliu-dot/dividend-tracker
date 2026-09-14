import React, { useState } from 'react';
import { useTaxBreakdown } from '@/lib/hooks/useTaxBreakdown';
import { useSettings } from '@/store/SettingsContext';
import { useData } from '@/store/DataContext';
import { useMoneyFmt } from '@/lib/hooks/useMoneyFmt';
import { formatPctPlain } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { CustodyChannel } from '@/types';

export function hongKongCustodyLabel(custodyChannel: CustodyChannel): string {
  if (custodyChannel === 'HK_STOCK_CONNECT') return '港股通持有 · 按 20% 预扣估算';
  if (custodyChannel === 'HK_LOCAL_BROKER') return '香港本地券商持有 · 股息税 0%';
  return '托管渠道未匹配 · 税额以券商实际扣缴为准';
}

export function validateTaxOverrideAmount(raw: string): { value?: number; error?: string } {
  if (raw.trim() === '') return { error: '请输入实际扣税金额' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: '请输入有效金额' };
  if (value < 0) return { error: '实际扣税金额不能小于 0' };
  return { value };
}

/** ★ 税务拆解卡片：三态（到账/或有/已扣）+ 再持有 N 天归零 + 免责声明 + 手动覆盖（PRD §3.2.2） */
export function TaxBreakdownCard({ instrumentId }: { instrumentId: string }) {
  const { settings } = useSettings();
  const { state, overrideTaxWithheld } = useData();
  const { fmt } = useMoneyFmt();
  const { rows, totalGross, totalWithheld, totalContingent, totalNet, maxDaysToZeroTax, currentBracketLabel, currentRate, lots } =
    useTaxBreakdown(instrumentId);
  const instrument = state.instruments.find((i) => i.id === instrumentId);

  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  if (!instrument) return null;

  const isAH = instrument.market === 'A_SHARE';
  const isUS = instrument.market === 'US';

  const openOverride = (id: string, current: number) => {
    setOverrideFor(id);
    setOverrideValue(String(current));
    setOverrideError(null);
  };

  const closeOverride = () => {
    setOverrideFor(null);
    setOverrideError(null);
  };

  const submitOverride = () => {
    if (!overrideFor) return;
    const result = validateTaxOverrideAmount(overrideValue);
    if (result.error !== undefined || result.value === undefined) {
      setOverrideError(result.error ?? '请输入有效金额');
      return;
    }
    overrideTaxWithheld(overrideFor, result.value);
    closeOverride();
  };

  return (
    <Card
      title={`税务拆解 · ${instrument.name}`}
      subtitle={
        isAH
          ? 'A股先派后税：派息到账全额，卖出时中登补扣'
          : isUS
            ? settings.w8benFilled
              ? '美股 W-8BEN 已填（10%）'
              : '美股 W-8BEN 未填（30% 保守估算）'
            : instrument.market === 'HK'
              ? hongKongCustodyLabel(instrument.custodyChannel)
              : instrument.market === 'FUND'
                ? '国内公募基金：个人暂不征收'
                : '不计算税务'
      }
      bodyClassName="p-4"
    >
      <div className="space-y-2">
        <div className="flex justify-between items-center text-[13px]">
          <span className="text-secondary">分红总额（税前）</span>
          <span className="num text-gold text-[16px] font-bold">{fmt(totalGross)}</span>
        </div>
        <div className="flex justify-between items-center text-[13px]">
          <span className="text-secondary">已实际扣税</span>
          <span className="num text-disabled">{fmt(totalWithheld)}</span>
        </div>
        <div className="flex justify-between items-center text-[13px]">
          <span className="text-secondary">或有税负（估算）</span>
          <span className="num text-warning">−{fmt(totalContingent)}</span>
        </div>
        <div className="border-t border-line-soft my-2" />
        <div className="flex justify-between items-center text-[14px]">
          <span className="text-primary font-medium">预计最终到手</span>
          <span className="num text-primary font-bold">{fmt(totalNet)}</span>
        </div>
      </div>

      {isAH && lots.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/25 bg-warning/5 p-2.5 text-[12px]">
          <div className="flex items-center gap-1.5 text-warning">
            <Badge variant="orange">当前税档</Badge>
            <span className="text-primary">{currentBracketLabel}</span>
            <span className="num text-secondary">综合税率 {formatPctPlain(currentRate)}</span>
          </div>
          {maxDaysToZeroTax > 0 ? (
            <p className="mt-1.5 text-primary">
              ⏳ 再持有 <span className="num text-warning font-bold">{maxDaysToZeroTax}</span> 天，
              <span className="num text-gold">{fmt(totalContingent)}</span> 或有税负将归零
            </p>
          ) : (
            <p className="mt-1.5 text-healthy">✓ 持股已满 1 年，或有税负已归零</p>
          )}
        </div>
      )}

      {isUS && (
        <div className="mt-3 rounded-md border border-warning/25 bg-warning/5 p-2.5 text-[11px] text-secondary">
          当前按 {settings.w8benFilled ? '10%' : '30%'} 预扣估算（{settings.w8benFilled ? '已填 W-8BEN' : '未填 W-8BEN'}）。
          {instrument.securityType === 'REIT' || instrument.securityType === 'MLP_PTP'
            ? ' REIT/MLP-PTP 一律 30%，不享协定优惠。'
            : ''}
          <span className="text-disabled"> 实际以券商扣缴为准，可手动覆盖。</span>
        </div>
      )}

      {/* 手动覆盖实际扣税 */}
      <div className="mt-3 space-y-1.5">
        {rows
          .filter((r) => r.dividend.status === 'PAID' || r.dividend.status === 'RECONCILED')
          .slice(0, 4)
          .map((r) => (
            <div key={r.dividend.id} className="flex items-center justify-between text-[11px]">
              <span className="text-secondary font-mono">{r.dividend.payDate ?? r.dividend.exDate}</span>
              <span className="num text-gold">{fmt(r.dividend.grossAmount)}</span>
              <span className="num text-disabled">税 {fmt(r.dividend.taxWithheld)}</span>
              <Button size="sm" variant="ghost" onClick={() => openOverride(r.dividend.id, r.dividend.taxWithheld)}>
                覆盖
              </Button>
            </div>
          ))}
      </div>

      <div className="mt-3 pt-2 border-t border-line-soft text-[10px] text-disabled">
        ⓘ 税额为系统估算，实际以中国结算扣缴为准（{instrument.market === 'A_SHARE' ? '中登' : '券商'}）· 回填实际到账金额可校准偏差
      </div>

      <Modal
        open={overrideFor !== null}
        title="手动覆盖实际扣税"
        onClose={closeOverride}
        footer={
          <>
            <Button variant="ghost" onClick={closeOverride}>取消</Button>
            <Button variant="primary" onClick={submitOverride}>保存</Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="实际扣税金额（本位币）"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={overrideValue}
            aria-invalid={overrideError !== null}
            aria-describedby={overrideError ? 'tax-override-error' : undefined}
            onChange={(e) => {
              setOverrideValue(e.target.value);
              setOverrideError(null);
            }}
            hint="用于与券商流水对账；覆盖后按实际扣税显示"
          />
          {overrideError && (
            <p id="tax-override-error" role="alert" className="text-[12px] text-danger">
              {overrideError}
            </p>
          )}
        </div>
      </Modal>
    </Card>
  );
}
