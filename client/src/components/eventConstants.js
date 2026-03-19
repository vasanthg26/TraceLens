/**
 * eventConstants.js
 * Purpose: Shared color map and legend for PeopleCode event types
 * Author: TraceLens
 */

export const COLOR_MAP = {
  red: '#f85149',       // RowInit
  coral: '#e06c60',     // RowInsert
  crimson: '#d63a4a',   // RowDelete
  salmon: '#e8836a',    // RowSelect
  blue: '#58a6ff',      // FieldChange
  sky: '#79c0ff',       // FieldEdit
  cyan: '#56d4dd',      // FieldDefault
  slate: '#768390',     // FieldFormula
  orange: '#d29922',    // SavePreChange
  amber: '#e3b341',     // SavePostChange
  gold: '#c69026',      // SaveEdit
  purple: '#bc8cff',    // SearchInit
  violet: '#a371f7',    // SearchSave
  green: '#3fb950',     // Activate
  lime: '#57ab5a',      // PreBuild
  teal: '#39d2c0',      // PostBuild
  pink: '#f778ba',      // PrePopup
  magenta: '#db61a2',   // ItemSelected
  indigo: '#6e7dd7',    // Workflow
  grey: '#6e7681'       // Other
};

export const EVENT_LEGEND = {
  'RowInit': 'red',
  'RowInsert': 'coral',
  'RowDelete': 'crimson',
  'RowSelect': 'salmon',
  'FieldChange': 'blue',
  'FieldEdit': 'sky',
  'FieldDefault': 'cyan',
  'FieldFormula': 'slate',
  'SavePreChange': 'orange',
  'SavePostChange': 'amber',
  'SaveEdit': 'gold',
  'SearchInit': 'purple',
  'SearchSave': 'violet',
  'Activate': 'green',
  'PreBuild': 'lime',
  'PostBuild': 'teal',
  'PrePopup': 'pink',
  'ItemSelected': 'magenta',
  'Workflow': 'indigo',
  'Other': 'grey'
};

/** Map a PeopleCode event name to its legend key (case-insensitive) */
export function eventToLegendKey(eventName) {
  if (!eventName) return 'Other';
  const lower = eventName.toLowerCase();
  for (const key of Object.keys(EVENT_LEGEND)) {
    if (lower.includes(key.toLowerCase())) return key;
  }
  return 'Other';
}
