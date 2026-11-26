const LABELS = {
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  missed: 'Missed',
};

// Tones match the .badge-* classes: success | warning | danger | info | neutral.
const TONES = {
  confirmed: 'info',
  checked_in: 'info',
  completed: 'success',
  cancelled: 'neutral',
  missed: 'danger',
};

export function statusLabel(status) {
  return LABELS[status] ?? String(status ?? '');
}

export function statusTone(status) {
  return TONES[status] ?? 'neutral';
}
