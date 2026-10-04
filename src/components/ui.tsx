import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun, Moon, LoaderCircle, Check, AlertCircle } from 'lucide-react';

export function DieIcon({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="m32 5 24 15v26L32 59 8 46V20L32 5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m32 5 13 31-37-16 24 39 24-39-37 16L32 5ZM8 46l37-10 11 10M19 36l13 23"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <DieIcon size={30} />
      </span>
      <span className="logo-word">
        幕间<span>INTERLUDE</span>
      </span>
    </span>
  );
}
export function ThemeToggle({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  return (
    <button
      className="icon-button theme-button"
      onClick={onToggle}
      title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
      aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
    >
      {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
    </button>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={17} aria-label="正在处理" />;
}
export function Toast({
  message,
  type = 'success',
}: {
  message: string;
  type?: 'success' | 'error';
}) {
  return (
    <div className={`toast ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      {type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
      <span>{message}</span>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  className = '',
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const root = document.getElementById('root');
    const previousInert = root?.inert ?? false;
    const previousAriaHidden = root?.getAttribute('aria-hidden') ?? null;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab') {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ) ?? [],
        ).filter((node) => node.offsetParent !== null);
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    ref.current?.focus();
    root?.setAttribute('aria-hidden', 'true');
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousAriaHidden === null) root?.removeAttribute('aria-hidden');
      else root?.setAttribute('aria-hidden', previousAriaHidden);
      if (root) root.inert = previousInert;
      document.removeEventListener('keydown', handle);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭窗口">
            <X size={20} />
          </button>
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
export const ruleName = (rule: 'dnd' | 'coc') => (rule === 'dnd' ? '龙与地下城' : '克苏鲁的呼唤');
export const ruleEdition = (rule: 'dnd' | 'coc') =>
  rule === 'dnd' ? 'D&D 5e · 2014' : 'CoC · 第 7 版';
export const hostName = (rule: 'dnd' | 'coc') => (rule === 'dnd' ? '地下城主 DM' : '守密人 KP');
