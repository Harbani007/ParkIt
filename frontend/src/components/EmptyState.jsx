// title, message, optional action node (a Link or button) and optional children.
export default function EmptyState({ title, message, action, children }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
      {children}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
