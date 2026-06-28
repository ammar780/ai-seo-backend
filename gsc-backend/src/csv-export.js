// src/csv-export.js
// Convert a report's table sections to CSV. Returns a string.

function escapeCSV(value) {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function reportToCSV(report) {
  const lines = [];
  lines.push(`# ${report.title || 'Report'}`);
  if (report.site) lines.push(`# Site: ${report.site}`);
  if (report.dateRange) lines.push(`# Date range: ${report.dateRange}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Scorecards
  if (report.scorecards?.length) {
    lines.push('Metric,Value,Delta %');
    for (const s of report.scorecards) {
      const delta = s.delta != null ? (typeof s.delta === 'number' ? s.delta.toFixed(1) + '%' : s.delta) : '';
      lines.push([escapeCSV(s.label), escapeCSV(s.value), escapeCSV(delta)].join(','));
    }
    lines.push('');
  }

  // Each table section becomes its own block
  const tables = (report.sections || []).filter((s) => s.type === 'table');
  for (const t of tables) {
    lines.push(`# ${t.title || 'Table'}`);
    if (t.subtitle) lines.push(`# ${t.subtitle}`);
    const cols = t.columns || [];
    lines.push(cols.map((c) => escapeCSV(c.label)).join(','));
    for (const row of t.rows || []) {
      lines.push(cols.map((c) => {
        let v = row[c.key];
        if (c.format === 'pct' && typeof v === 'number') v = (v * 100).toFixed(2) + '%';
        if (c.format === 'position' && typeof v === 'number') v = v.toFixed(1);
        return escapeCSV(v);
      }).join(','));
    }
    lines.push('');
  }

  return lines.join('\n');
}
