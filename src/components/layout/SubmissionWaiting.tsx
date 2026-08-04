import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface SubmittedItem {
  label: string;
  value: string;
}

/** 录入等待态（PRD §3.2.11）：进度条 + 90 秒文案 + 已提交内容回显 + 完成后自动刷新 */
export function SubmissionWaiting() {
  const location = useLocation();
  const navigate = useNavigate();
  const items = (location.state?.items ?? []) as SubmittedItem[];

  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'pending' | 'done'>('pending');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const total = 90; // 秒
    const start = Date.now();
    const timer = window.setInterval(() => {
      const el = Math.min(total, Math.floor((Date.now() - start) / 1000));
      setElapsed(el);
      setProgress(Math.min(100, Math.round((el / total) * 100)));
      if (el >= total) {
        setPhase('done');
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const goHome = () => navigate('/', { replace: true });

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <Card className="w-full max-w-md" bodyClassName="p-6">
        <div className="text-center mb-5">
          {phase === 'pending' ? (
            <Loader2 size={36} className="text-declared mx-auto animate-spin mb-3" />
          ) : (
            <CheckCircle2 size={36} className="text-healthy mx-auto mb-3" />
          )}
          <h2 className="text-[16px] font-semibold text-primary">
            {phase === 'pending' ? '正在重算组合数据' : '数据已更新'}
          </h2>
          <p className="text-[12px] text-secondary mt-1">
            {phase === 'pending'
              ? '静态架构固有延迟：GitHub Actions 重算 + Pages 重建，预计 90 秒'
              : '页面已刷新，所有派生数据（持仓/税务/预测/日历）已重算'}
          </p>
        </div>

        {/* 进度条 */}
        <div className="h-2 rounded-full bg-card-hover overflow-hidden mb-2">
          <div
            className="h-full bg-gold transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-disabled mb-5">
          <span>
            {phase === 'pending' ? `${elapsed}s / 90s` : '完成'}
          </span>
          <span className="num">{progress}%</span>
        </div>

        {/* 已提交内容回显 */}
        {items.length > 0 && (
          <div className="border border-line rounded-md divide-y divide-line-soft mb-5">
            {items.map((it, i) => (
              <div key={i} className="flex justify-between gap-3 px-3 py-2 text-[12px]">
                <span className="text-secondary">{it.label}</span>
                <span className="text-primary font-mono num">{it.value}</span>
              </div>
            ))}
          </div>
        )}

        {phase === 'done' ? (
          <Button variant="primary" full onClick={goHome}>
            <RefreshCw size={14} /> 返回看板查看更新
          </Button>
        ) : (
          <p className="text-[11px] text-disabled text-center">
            构建较慢时，可稍后刷新查看 · 指向 Actions 运行日志
          </p>
        )}
      </Card>
    </div>
  );
}
