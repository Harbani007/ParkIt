// tone: 'info' | 'success' | 'warning' | 'danger'. Danger uses role="alert", others role="status".
export default function Alert({ tone = 'info', title, children, className, ...rest }) {
  const role = tone === 'danger' ? 'alert' : 'status';
  return (
    <div className={`alert alert-${tone}${className ? ` ${className}` : ''}`} role={role} {...rest}>
      {title ? <p><strong>{title}</strong></p> : null}
      {children}
    </div>
  );
}
