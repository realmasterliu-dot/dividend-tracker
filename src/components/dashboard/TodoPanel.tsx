import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardList, RefreshCw } from 'lucide-react';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const severityColor = { INFO: 'cyan', WARN: 'orange', ERROR: 'red' } as const;
const kindIcon = {
  PENDING_TX: ClipboardList,
  DATA_STALE: AlertTriangle,
  PAY_BACKFILL: RefreshCw,
  CORP_ACTION: AlertTriangle,
  TAX_BRACKET: AlertTriangle,
};

/** 待办区（待确认流水 N 笔 / 待处理数据异常 N 条） */
export function TodoPanel() {
  const { todos, pendingTxCount } = usePortfolio();

  if (todos.length === 0) {
    return (
      <Card title="待办区" bodyClassName="p-4">
        <div className="text-[12px] text-secondary">🎉 没有待办事项，一切正常</div>
      </Card>
    );
  }

  return (
    <Card
      title="待办区"
      subtitle={`待确认流水 ${pendingTxCount} 笔 · 待处理数据异常 ${todos.filter((t) => t.severity !== 'INFO').length} 条`}
      bodyClassName="p-2"
    >
      <ul className="divide-y divide-line-soft">
        {todos.slice(0, 6).map((todo) => {
          const Icon = kindIcon[todo.kind] ?? AlertTriangle;
          return (
            <li key={todo.id} className="flex items-start gap-2.5 px-2 py-2">
              <Icon size={14} className="mt-0.5 text-warning shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-primary font-medium truncate">{todo.title}</span>
                  <Badge variant={severityColor[todo.severity]}>{todo.severity}</Badge>
                </div>
                <p className="text-[11px] text-secondary truncate mt-0.5">{todo.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {pendingTxCount > 0 && (
        <div className="p-2 pt-1">
          <Link to="/transactions">
            <Button variant="gold" size="sm" full>
              去确认流水 →
            </Button>
          </Link>
        </div>
      )}
    </Card>
  );
}
