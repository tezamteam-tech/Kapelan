/**
 * Copies text to clipboard.
 * Uses the modern Clipboard API if available and permitted,
 * falls back to execCommand('copy') otherwise.
 */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (_) {
    // silent fail
  }
  document.body.removeChild(textarea);
}
