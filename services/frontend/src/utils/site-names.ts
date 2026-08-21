/**
 * The placeholder name a site gets when nobody named it yet.
 *
 * Ingestion writes it when it auto-creates a site
 * (`services/ingestion/db_operations.py`, `_find_or_create_site`), and
 * `scripts/backfill_sites.py` uses the same format. Four decimals, a comma
 * and a space. Change one and change all of them.
 *
 * The two halves live together on purpose: the feed both writes such a name
 * (the "new site" dialog prefills it) and recognises one (an auto-named site
 * gets the "name this site" nudge). If the writer and the reader drift, the
 * nudge stops appearing on exactly the sites that need it.
 */

// The placeholder for a spot, e.g. "Site at 52.8747, 6.8522".
export function autoSiteName(lat: number, lon: number): string {
  return `Site at ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

// Whether a site still carries a placeholder name, so it is worth naming.
export function isAutoSiteName(name: string | null | undefined): boolean {
  return /^Site at -?\d+\.\d+, -?\d+\.\d+$/.test(name ?? '');
}
