import { useId, type ReactNode } from 'react'

interface InputProps {
  id: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

interface Props {
  label: string
  required?: boolean
  error?: string
  hint?: ReactNode
  wide?: boolean
  hideLabel?: boolean
  className?: string
  children: (props: InputProps) => ReactNode
}

/** A labelled native input with its hint or error, wired for screen readers. */
export function Field({ label, required, error, hint, wide, hideLabel, className, children }: Props) {
  const id = useId()
  const msg = error || hint ? `${id}-msg` : undefined
  return (
    <div className={`field${wide ? ' span-2' : ''}${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
        {required && !hideLabel ? <span className="req" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': msg, 'aria-required': required || undefined })}
      {error ? (
        <p id={msg} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={msg} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
