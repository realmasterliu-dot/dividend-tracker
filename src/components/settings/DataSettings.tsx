import React, { useRef, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { useData } from '@/store/DataContext';
import { useSettings } from '@/store/SettingsContext';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

/** 数据导出 CSV/JSON + 个人数据 holdings.json 维护 + 年度被动收入目标 + 重置 */
export function DataSettings() {
  const { state, resetState, exportPersonalData, importPersonalData, reloadPersonalData } = useData();
  const { settings, update } = useSettings();
  const { ttmDividendTotal } = usePortfolio();
  const [resetOpen, setResetOpen] = useState(false);
  const [holdingsHint, setHoldingsHint] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续选同一个文件重试
    if (!file) return;
    try {
      const text = await file.text();
      const warnings = importPersonalData(text);
      // 缺片不算失败：另两片按「保留当前数据」处理，只做如实告知
      const suffix = warnings.length > 0 ? `（${warnings.join('；')}）` : '';
      setHoldingsHint({ tone: 'ok', text: `已导入 ${file.name}，记得导出后提交回仓库${suffix}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.warn('[DataSettings] 个人数据导入失败：', error);
      setHoldingsHint({ tone: 'err', text: `导入失败：${message}` });
    }
  };

  const handleReload = async () => {
    try {
      const bundle = await reloadPersonalData();
      if (bundle.source === 'file') {
        const counts = `${bundle.instruments.length} 标的 / ${bundle.transactions.length} 流水 / ${bundle.plans.length} 计划`;
        setHoldingsHint({ tone: 'ok', text: `已从服务器重新加载 holdings.json（${counts}）` });
      } else {
        // ★降级信号必须显性化：回退种子时报「成功」等于骗用户
        const reason = bundle.warnings[0] ?? '未知原因';
        setHoldingsHint({ tone: 'err', text: `holdings.json 读取失败，已回退内置种子：${reason}` });
      }
    } catch (error) {
      // loadPersonalData 承诺不抛出，此处仅作兜底
      const message = error instanceof Error ? error.message : String(error);
      setHoldingsHint({ tone: 'err', text: `重新加载失败：${message}` });
    }
  };

  const handleExport = () => {
    exportPersonalData();
    setHoldingsHint({ tone: 'ok', text: '已下载 holdings.json，替换 public/data/holdings.json 后提交即可' });
  };

  const exportCsv = () => {
    const rows = [
      ['日期', '类型', '标的', '数量', '价格', '金额', '币种', '状态'],
      ...state.transactions.map((t) => [
        t.date,
        t.type,
        t.instrumentId,
        String(t.quantity),
        String(t.price),
        String(t.amount),
        t.currency,
        t.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    download('transactions.csv', '\uFEFF' + csv);
  };

  const exportJson = () => {
    download('dividend-tracker-data.json', JSON.stringify(state, null, 2));
  };

  const download = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const target = settings.annualIncomeTarget;
  const progress = target && target > 0 ? Math.min(1, ttmDividendTotal / target) : 0;

  return (
    <Card title="数据与目标" bodyClassName="p-4 space-y-4">
      <div>
        <div className="text-[13px] text-primary font-medium mb-2">年度被动收入目标（进度只计已到账）</div>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={target ?? ''}
            placeholder="不设目标"
            onChange={(e) => update({ annualIncomeTarget: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span className="text-[12px] text-secondary">当前 {Math.round(progress * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-card-hover overflow-hidden">
          <div className="h-full bg-gold" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="text-[11px] text-disabled mt-1">预测值不计入进度，只有已到账才算数</div>
      </div>

      <div className="pt-3 border-t border-line-soft">
        <div className="text-[13px] text-primary font-medium mb-2">数据导出（本地）</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download size={13} /> 导出 CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportJson}>
            <Download size={13} /> 导出 JSON
          </Button>
        </div>
        <div className="text-[11px] text-disabled mt-1.5">
          个人数据保存在浏览器 localStorage（key: dt:state:v2 / dt:settings:v1）；
          行情·汇率·分红事件每次启动从 public/data 数据管道重新加载，不占用本地配额。导出 JSON 可作备份
        </div>
      </div>

      <div className="pt-3 border-t border-line-soft">
        <div className="text-[13px] text-primary font-medium mb-2">个人数据（holdings.json）</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-1.5 text-[12px] rounded-md bg-card-hover text-primary"
          >
            导出个人数据
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-[12px] rounded-md bg-card-hover text-primary"
          >
            从文件导入
          </button>
          <button
            type="button"
            onClick={() => void handleReload()}
            className="px-3 py-1.5 text-[12px] rounded-md bg-card-hover text-primary"
          >
            从服务器重新加载
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void handleImportFile(e)}
          />
        </div>
        {holdingsHint && (
          <div className={`text-[11px] mt-1.5 ${holdingsHint.tone === 'err' ? 'text-danger' : 'text-secondary'}`}>
            {holdingsHint.text}
          </div>
        )}
        <div className="text-[11px] text-disabled mt-1.5">
          标的·流水·定投计划基线存于 public/data/holdings.json；编辑后提交仓库，
          在本机点「从服务器重新加载」即可同步。回访时本地编辑优先于服务器基线
        </div>
      </div>

      <div className="pt-3 border-t border-line-soft">
        <Button variant="danger" size="sm" onClick={() => setResetOpen(true)}>
          <RotateCcw size={13} /> 清空并重置为演示数据
        </Button>
      </div>

      <Modal
        open={resetOpen}
        title="确认重置"
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>取消</Button>
            <Button variant="danger" onClick={() => { resetState(); setResetOpen(false); }}>确认重置</Button>
          </>
        }
      >
        <p className="text-[12px] text-secondary">
          将清空本地全部数据并恢复六类资产演示种子。此操作不可撤销，建议先导出 JSON 备份。
        </p>
      </Modal>
    </Card>
  );
}
