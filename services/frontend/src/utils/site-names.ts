/**
 * The placeholder name a site gets when nobody named it yet.
 *
 * The rebuild writes it when it makes a site for a new place
 * (`auto_site_name` and `is_auto_site_name` in `shared/shared/geo.py`):
 * "Site at 52.8747, 6.8522", four decimals, a comma and a space. The
 * browser only recognises one: such a site shows as Unnamed and gets "Name
 * this site". Change the format there and change the pattern here.
 */

// Whether a site still carries a placeholder name, so it is worth naming.
export function isAutoSiteName(name: string | null | undefined): boolean {
  return /^Site at -?\d+\.\d+, -?\d+\.\d+$/.test(name ?? '');
}
