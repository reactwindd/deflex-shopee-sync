import { useState } from 'react';

/**
 * Click-to-copy identifier. Hover reveals a hint; left-click copies the
 * value to the clipboard (with a fallback for http:// LAN addresses where
 * the async Clipboard API is unavailable).
 */
export function CopyId({ text, size = 'md' }: { text: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        /* fall through to legacy path */
      }
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <span
      className={'copy-id' + (copied ? ' copied' : '') + (size === 'sm' ? ' copy-id-sm' : '')}
      role="button"
      tabIndex={0}
      title="Click to copy"
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          copy();
        }
      }}
    >
      <span className="copy-id-value">{text}</span>
      <span className="copy-hint" aria-live="polite">
        {copied ? '✓ Copied' : '⧉ copy'}
      </span>
    </span>
  );
}
