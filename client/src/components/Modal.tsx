import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative w-full ${width} max-h-[90vh] overflow-y-auto rounded-xl bg-surface-1 border border-hairline shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline sticky top-0 bg-surface-1">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink-secondary font-medium">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent w-full';
