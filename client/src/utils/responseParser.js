/**
 * responseParser.js
 * Purpose: Parses LLM response text into structured segments for rendering
 * Splits narrative text from PS finding cards and PeopleCode blocks
 */

/**
 * Parse a FINDING block into structured data.
 * Expected format:
 *   FINDING: [title]
 *   Component  : [value]
 *   Record     : [value]
 *   Field      : [value]
 *   Event      : [value]
 *   Level      : [value]
 *   Evidence   : [value]
 *   Suggestion : [value]
 */
function parseFindingBlock(text) {
  const titleMatch = text.match(/^FINDING:\s*(.+)/im);
  if (!titleMatch) return null;

  const extract = (field) => {
    const re = new RegExp(`^${field}\\s*:\\s*(.+)`, 'im');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  return {
    title:     titleMatch[1].trim(),
    component: extract('Component'),
    record:    extract('Record'),
    field:     extract('Field'),
    event:     extract('Event'),
    level:     extract('Level'),
    evidence:  extract('Evidence'),
    suggestion: extract('Suggestion')
  };
}

/**
 * Determine severity from finding title or surrounding text.
 */
function detectSeverity(text) {
  const upper = text.toUpperCase();
  if (upper.includes('CRITICAL') || upper.includes('ERROR') || upper.includes('FAILED'))
    return 'critical';
  if (upper.includes('WARNING') || upper.includes('WARN') || upper.includes('SLOW') || upper.includes('N+1'))
    return 'warning';
  if (upper.includes('INFO') || upper.includes('NOTE'))
    return 'info';
  return 'info';
}

/**
 * Parse LLM response text into an array of typed segments.
 * Segment types:
 *   { type: 'narrative', text: '...' }
 *   { type: 'finding', data: { title, component, ... }, severity: '...' }
 *   { type: 'peoplecode', code: '...' }
 *
 * @param {string} text - raw LLM response
 * @returns {Array} segments
 */
function parseResponse(text) {
  if (!text) return [];

  const segments = [];
  let remaining = text;

  // Pattern: FINDING block — starts with "FINDING:" on its own line
  // Pattern: PeopleCode block — between "--- PeopleCode ---" and "--- End PeopleCode ---"
  const findingPattern = /^(FINDING:[\s\S]*?)(?=^FINDING:|^---\s*PeopleCode\s*---|\z)/im;
  const pcPattern = /^---\s*PeopleCode\s*---\n([\s\S]*?)^---\s*End PeopleCode\s*---/im;

  // Split by finding blocks and PeopleCode blocks
  while (remaining.length > 0) {
    const findingMatch = findingPattern.exec(remaining);
    const pcMatch = pcPattern.exec(remaining);

    // Find the earliest match
    const findingIdx = findingMatch ? findingMatch.index : Infinity;
    const pcIdx = pcMatch ? pcMatch.index : Infinity;

    if (findingIdx === Infinity && pcIdx === Infinity) {
      // No more special blocks — rest is narrative
      const narrative = remaining.trim();
      if (narrative) segments.push({ type: 'narrative', text: narrative });
      break;
    }

    const firstIdx = Math.min(findingIdx, pcIdx);

    // Narrative before first match
    if (firstIdx > 0) {
      const before = remaining.slice(0, firstIdx).trim();
      if (before) segments.push({ type: 'narrative', text: before });
    }

    if (findingIdx <= pcIdx) {
      // Process finding block
      const findingText = findingMatch[1];
      const parsed = parseFindingBlock(findingText);
      if (parsed) {
        segments.push({
          type: 'finding',
          data: parsed,
          severity: detectSeverity(findingText)
        });
      } else {
        segments.push({ type: 'narrative', text: findingText.trim() });
      }
      remaining = remaining.slice(findingIdx + findingMatch[1].length);
    } else {
      // Process PeopleCode block
      const code = pcMatch[1].trim();
      segments.push({ type: 'peoplecode', code });
      remaining = remaining.slice(pcIdx + pcMatch[0].length);
    }
  }

  return segments;
}

export { parseResponse, detectSeverity };
