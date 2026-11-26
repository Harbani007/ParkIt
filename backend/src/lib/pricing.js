// D5: amount = min(hours * hourly_rate, daily_rate), computed in integer paise.

function toPaise(value) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money amount: ${value}`);
  const [rupees, frac = ''] = s.split('.');
  return Number(rupees) * 100 + Number(frac.padEnd(2, '0'));
}

function fromPaise(paise) {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** Rates may be pg strings ("40.00") or numbers. Returns a string such as "280.00". */
export function priceFor(hours, hourlyRate, dailyRate) {
  const hourly = toPaise(hourlyRate) * hours;
  return fromPaise(Math.min(hourly, toPaise(dailyRate)));
}
