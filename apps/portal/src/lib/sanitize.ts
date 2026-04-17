import DOMPurify from 'dompurify';

const purify =
  typeof window !== 'undefined' ? DOMPurify(window) : null;

export function sanitize(html: string): string {
  if (!purify) return html.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] ?? c));
  return purify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
