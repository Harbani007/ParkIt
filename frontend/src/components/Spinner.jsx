// Spinner with an accessible label. `inline` renders only the decorative circle (for use inside
// a button whose text already describes the action).
export default function Spinner({ label = 'Loading', inline = false, className }) {
  const cls = `spinner${className ? ` ${className}` : ''}`;
  if (inline) return <span className={cls} aria-hidden="true" />;
  return (
    <span className="row" role="status">
      <span className={cls} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
