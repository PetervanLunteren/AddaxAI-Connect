/**
 * Saving a file from the browser: one helper for a blob the API returned and
 * for text the page built itself.
 */

/** Save a blob as a file with this name. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/** One CSV line. A field with a comma, a quote or a line break is quoted. */
function csvLine(fields: string[]): string {
  return fields
    .map((field) => (/[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field))
    .join(',');
}

/**
 * Save rows as a CSV file, the header first. The file starts with a byte
 * order mark, so Excel reads labels with accents correctly.
 */
export function downloadCsv(header: string[], rows: string[][], filename: string): void {
  const text = [header, ...rows].map(csvLine).join('\n') + '\n';
  downloadBlob(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }), filename);
}
