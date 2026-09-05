import React, { useRef, useState } from 'react';
import { Download, FileUp, Trash2 } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

function download(name: string, content: string, type = 'application/octet-stream') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 收入目标、可迁移备份和清空操作；不再引导用户把真实持仓提交到公开仓库。 */
export function DataSettings() {
  const { state, resetState, exportPersonalData, importPersonalData } = useData();
  const { settings, update } = useSettings();
  const { ttmDividendTotal } = usePortfolio();
  const [clearOpen, setClearOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const target = settings.annualIncomeTarget;
  const progress = target && target > 0 ? Math.min(1, ttmDividendTotal / target) : 0;

  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const warnings = importPersonalData(await file.text());
      setMessage({
        tone: 'ok',
        text: warnings.length > 0 ? `已导入；${warnings.join('；')}` : '账本备份已导入',
      });
    } catch (cause) {
      setMessage({ tone: 'err', text: `导入失败：${cause instanceof Error ? cause.message : String(cause)}` });
    }
  };

  const exportCsv = () => {
    const rows = [
      ['日期', '类型', '标的', '数量', '价格', '金额', '币种', '状态', '备注'],
      ...state.transactions.map((transaction) => [
        transaction.date,
        transaction.type,
        transaction.instrumentId,
        String(transaction.quantity),
        String(transaction.price),
        String(transaction.amount),
        transaction.currency,
        transaction.status,
        transaction.note ?? '',
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    download('dividend-ledger.csv', `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  };

  return (
    <Card title="目标与数据" bodyClassName="space-y-5 p-4">
      <div>
        <label className="mb-2 block text-[13px] font-medium text-primary">年度分红目标</label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min="0"
            value={target ?? ''}
            placeholder="不设目标"
            onChange={(event) =>
              update({ annualIncomeTarget: event.target.value ? Number(event.target.value) : undefined })
            }
          />
          <span className="w-14 shrink-0 text-right text-[12px] text-secondary">{Math.round(progress * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-hover">
          <div className="h-full bg-gold transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-disabled">只按近 12 个月已确认分红计算。</p>
      </div>

      <div className="border-t border-line-soft pt-4">
        <p className="mb-2 text-[13px] font-medium text-primary">备份与迁移</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportPersonalData}>
            <Download size={15} /> 导出账本备份
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={15} /> 导入账本备份
          </Button>
          <Button variant="ghost" onClick={exportCsv}>导出 CSV</Button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importBackup(event)}
          />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-disabled">
          备份包含标的、流水、定投、手工分红与校准、通知状态和设置；不包含可重新获取的行情与汇率。请勿公开分享。
        </p>
        {message && (
          <p role="status" className={`mt-2 text-[12px] ${message.tone === 'err' ? 'text-danger' : 'text-healthy'}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line-soft pt-4">
        <div>
          <p className="text-[13px] font-medium text-primary">清空账本</p>
          <p className="mt-0.5 text-[11px] text-secondary">删除全部个人记录，行情数据不受影响。</p>
        </div>
        <Button variant="danger" onClick={() => setClearOpen(true)}>
          <Trash2 size={15} /> 清空
        </Button>
      </div>

      <Modal
        open={clearOpen}
        title="确认清空账本？"
        onClose={() => setClearOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                resetState();
                setClearOpen(false);
                setMessage({ tone: 'ok', text: '账本已清空' });
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-6 text-secondary">
          标的、流水、分红订正和定投计划都会被删除；已登录时也会同步到云端。建议先导出备份。
        </p>
      </Modal>
    </Card>
  );
}
