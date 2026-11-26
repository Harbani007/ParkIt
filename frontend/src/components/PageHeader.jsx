// h1 + optional subtitle; `actions` renders on the right and wraps on phones.
// Pass `headingRef` to move focus to the heading after navigation.
export default function PageHeader({ title, subtitle, actions, headingRef }) {
  return (
    <div className="page-header">
      <div>
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row no-print">{actions}</div> : null}
    </div>
  );
}
