import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}

/** 弹窗（录入/回填用） */
export function Modal({ open, title, onClose, children, footer, width = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-black/60 sm:items-start sm:overflow-y-auto sm:p-4 sm:pt-[8vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={clsx(
          'panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none rounded-t-2xl shadow-glow sm:max-h-none sm:rounded-lg',
          width,
        )}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-[16px] font-semibold text-primary sm:text-[14px]">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-secondary hover:bg-card-hover hover:text-primary"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 [&>button]:min-w-[96px]">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
