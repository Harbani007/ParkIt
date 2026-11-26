import { formatINR } from '../lib/money.js';

export const ANY_SLOT = 'any';

/**
 * Price shown on the "Any free slot" tile (F5): the common amount if all free slots agree,
 * otherwise "from <lowest>". Returns { text, amount } where amount is the string to display
 * for the lowest price, or null when nothing is free.
 */
export function anySlotPrice(slots) {
  const free = slots.filter((s) => s.available);
  if (free.length === 0) return null;
  const lowest = free.reduce((a, s) => (Number(s.amount) < Number(a.amount) ? s : a), free[0]);
  const same = free.every((s) => Number(s.amount) === Number(lowest.amount));
  return {
    amount: lowest.amount,
    same,
    text: same ? formatINR(lowest.amount) : `from ${formatINR(lowest.amount)}`,
  };
}

/**
 * Radio-group of slot tiles. `slots` are availability rows already filtered to one vehicle type.
 * `value` is ANY_SLOT, a slot id, or null. Native radios inside a fieldset give arrow-key
 * navigation and screen-reader group semantics; disabled tiles state the reason in text.
 */
export default function SlotGrid({ slots, value, onChange, legend = 'Choose a slot', disabled = false }) {
  const any = anySlotPrice(slots);
  const anyDisabled = disabled || !any;

  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="visually-hidden">{legend}</legend>
      <div className="slot-grid">
        <label
          className={`slot-tile${value === ANY_SLOT ? ' is-selected' : ''}${anyDisabled ? ' is-unavailable' : ''}`}
        >
          <input
            type="radio"
            name="slot"
            value={ANY_SLOT}
            checked={value === ANY_SLOT}
            disabled={anyDisabled}
            onChange={() => onChange(ANY_SLOT)}
          />
          <span className="slot-code">Any free slot</span>
          <span className="slot-state">{any ? 'Least-used slot' : 'None free'}</span>
          {any ? <span className="slot-price">{any.text}</span> : null}
        </label>

        {slots.map((s) => {
          const off = disabled || !s.available;
          return (
            <label
              key={s.id}
              className={`slot-tile${value === s.id ? ' is-selected' : ''}${!s.available ? ' is-unavailable' : ''}`}
            >
              <input
                type="radio"
                name="slot"
                value={s.id}
                checked={value === s.id}
                disabled={off}
                onChange={() => onChange(s.id)}
              />
              <span className="slot-code">{s.code}</span>
              <span className="slot-state">{s.available ? 'Free' : 'Booked for this time'}</span>
              <span className="slot-price">{formatINR(s.amount)}</span>
            </label>
          );
        })}
      </div>
      <p className="field-hint">
        &ldquo;Any free slot&rdquo; books the slot that has been used least in the last 30 days, which
        spreads wear evenly. Pick a specific slot if you prefer one.
      </p>
    </fieldset>
  );
}
