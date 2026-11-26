// Money arrives as strings like "280.00". Format with string handling only (F11).

function groupIndian(intPart) {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** formatINR("4560.00") -> "₹4,560.00"; null, undefined or invalid -> "—". */
export function formatINR(value) {
  if (value === null || value === undefined || value === '') return '—';
  const s = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return '—';
  const [, sign, int, frac = ''] = m;
  // The API always sends 2 decimals; longer input is rounded by Number as a rare fallback.
  const cents = (frac.length > 2 ? Number(`0.${frac}`).toFixed(2).slice(2) : frac).padEnd(2, '0');
  const whole = int.replace(/^0+(?=\d)/, '');
  const neg = sign && /[1-9]/.test(whole + cents) ? '-' : '';
  return `${neg}₹${groupIndian(whole)}.${cents}`;
}
