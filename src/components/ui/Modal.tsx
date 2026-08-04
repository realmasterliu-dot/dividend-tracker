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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]">
      <div
        className={clsx('panel w-full shadow-glow', width)}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="text-[14px] font-semibold text-primary">{title}</h3>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary p-1 rounded"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </header>
        <div className="p-4">{children}</div>
        {footer && <footer className="px-4 py-3 border-t border-line flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
}
