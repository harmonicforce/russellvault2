import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Drawer({ open, onClose, title, children, width = 'max-w-xl' }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative w-full ${width} h-full bg-surface-1 border-l border-hairline shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
