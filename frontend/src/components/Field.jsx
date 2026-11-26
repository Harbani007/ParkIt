import { cloneElement, isValidElement, useId } from 'react';

// Label + control + hint + error, wired with for/id and aria-describedby.
// Pass a ready-made control as the single child element (it receives id, aria-describedby,
// aria-invalid), or omit it and pass `as` ('input' | 'select' | 'textarea') plus control props.
// For as="select", pass <option> elements via `options`.
export default function Field({
  label,
  id,
  hint,
  error,
  required,
  as = 'input',
  className,
  options,
  children,
  ...controlProps
}) {
  const auto = useId();
  const fieldId = id ?? `f${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${fieldId}-hint` : null;
  const errorId = error ? `${fieldId}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const invalid = error ? 'true' : undefined;

  let control;
  if (isValidElement(children)) {
    const own = children.props['aria-describedby'];
    control = cloneElement(children, {
      id: fieldId,
      'aria-describedby': [own, describedBy].filter(Boolean).join(' ') || undefined,
      'aria-invalid': invalid ?? children.props['aria-invalid'],
      required: required || children.props.required,
    });
  } else {
    const shared = {
      id: fieldId,
      'aria-describedby': describedBy,
      'aria-invalid': invalid,
      required: required || undefined,
      ...controlProps,
    };
    if (as === 'select') control = <select className="select" {...shared}>{options}</select>;
    else if (as === 'textarea') control = <textarea className="input" {...shared} />;
    else control = <input className="input" {...shared} />;
  }

  return (
    <div className={`field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={fieldId}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {hint ? <p className="field-hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}
