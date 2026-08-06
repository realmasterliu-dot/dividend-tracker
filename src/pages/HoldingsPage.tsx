import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { HoldingsTable } from '@/components/holdings/HoldingsTable';
import { AddHoldingModal } from '@/components/holdings/AddHoldingModal';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

/** 持仓表页（14 列密集表格） */
export function HoldingsPage() {
  const [hint] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-primary">持仓</h2>
          <p className="text-[12px] text-secondary mt-0.5">
            持仓由交易流水推导（FIFO）· 点击行展开 TaxLot 明细 · 列可排序/隐藏
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={13} /> 新增持仓
          </Button>
          <Badge variant="gray">行高 32-36px</Badge>
          <Link to="/transactions" className="text-[12px] text-declared hover:underline">录入流水 →</Link>
        </div>
      </div>

      {hint && (
        <div className="rounded-md border border-line bg-card/40 px-3 py-2 text-[11px] text-secondary">
          💡 涨跌表现用「文字色 + 极淡背景条」表示，不用整行色块；不可分红资产（黄金/加密）股息率列显示 <span className="num text-disabled">—</span>
        </div>
      )}

      <Card bodyClassName="p-0">
        <HoldingsTable />
      </Card>

      <AddHoldingModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
