/**
 * classifyProgram.js
 * Classify a PeopleCode program as 'portal' (PeopleTools infrastructure) or 'app' (business logic).
 * Portal code: PT* prefixed records, FUNCLIB_PORTAL, WEBLIB_PT*, system records.
 */

const PORTAL_EXACT = new Set([
  'PSOPTIONS', 'TRACE_SQL', 'PSVERSION', 'INSTALLATION', 'PSMSGCATDEFN'
]);

function classifyProgram(program) {
  if (!program) return 'app';
  const record = program.split('.')[0].toUpperCase();
  if (PORTAL_EXACT.has(record)) return 'portal';
  if (
    record.startsWith('PT') ||
    record.startsWith('FUNCLIB_PT') ||
    record.startsWith('FUNCLIB_PORTAL') ||
    record.startsWith('WEBLIB_PT') ||
    record.startsWith('WEBLIB_PTBR')
  ) return 'portal';
  return 'app';
}

module.exports = classifyProgram;
