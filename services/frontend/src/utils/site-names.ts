/**
 * The placeholder name a site gets when nobody named it yet.
 *
 * The rebuild writes it when it makes a site for a new place
 * (`auto_site_name` and `is_auto_site_name` in `shared/shared/geo.py`).
 * Four decimals, a comma and a space. Change one and change both.
 *
 * The two halves live together on purpose: the site form prefills such a
 * name and the Deployments page recognises one (an auto-named site gets
 * "Name this site", and the server removes it once a correction empties
 * it). If the writer and the reader drift, both stop working.
 */

// The placeholder for a spot, e.g. "Site at 52.8747, 6.8522".
export function autoSiteName(lat: number, lon: number): string {
  return `Site at ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

// Whether a site still carries a placeholder name, so it is worth naming.
export function isAutoSiteName(name: string | null | undefined): boolean {
  return /^Site at -?\d+\.\d+, -?\d+\.\d+$/.test(name ?? '');
}
