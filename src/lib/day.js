/**
 * A date as this system writes one: 05 Sep 2026.
 *
 * ── Why the month is cut to three letters ──
 *
 * English (Malaysia) — and British English, which it follows — shortens
 * September to "Sept". It is the only month of the twelve that is four
 * letters, so a column of dates fell out of line on one month of the year and
 * September alone looked like a different format from the other eleven.
 *
 * The name still comes from the LOCALE rather than a list written out here,
 * so Malay keeps its own months — Mac, Mei, Ogo, Okt, Dis — which a hardcoded
 * English list would have silently replaced with the wrong words. Malay's are
 * three letters already, so the cut changes nothing there. The trailing dot
 * some locales add goes with it.
 *
 * No imports, so it stays testable in plain node.
 */

/** The locale for a language code. Two languages, one place that knows it. */
export const localeOf = (lang) => (lang === 'ms' ? 'ms-MY' : 'en-MY');

/** A Date → "05 Sep 2026". `pad` false gives "5 Sep 2026". */
export function shortDate(d, locale, pad = true) {
  const parts = new Intl.DateTimeFormat(locale, {
    day: pad ? '2-digit' : 'numeric', month: 'short', year: 'numeric',
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${get('day')} ${get('month').replace(/\./g, '').slice(0, 3)} ${get('year')}`;
}
