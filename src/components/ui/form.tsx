'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Form controls.
 *
 * Every control is labelled, every error is tied to its input with
 * aria-describedby, and required fields are marked both visually and for
 * assistive technology. Help text is rendered above errors so that the
 * instruction stays visible while the error is being fixed.
 */

const CONTROL =
  'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

const CONTROL_ERROR = 'ring-rose-400 focus:ring-rose-500';

export function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
  className,
  hint,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Right-aligned secondary note, e.g. a character count. */
  hint?: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
          {label}
          {required && (
            <span className="ml-1 text-rose-600" title="Required">
              *
            </span>
          )}
          {required === false && <span className="ml-1.5 text-xs font-normal text-slate-500">(optional)</span>}
        </label>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {help && <p className="text-xs leading-relaxed text-slate-600">{help}</p>}
      {children}
      {error && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-rose-700">
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  help?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, help, error, hint, className, containerClassName, id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [help ? `${inputId}-help` : null, error ? `${inputId}-error` : null]
    .filter(Boolean)
    .join(' ');

  const control = (
    <input
      ref={ref}
      id={inputId}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      className={cn(CONTROL, error && CONTROL_ERROR, className)}
      {...rest}
    />
  );

  if (!label) return control;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      help={help ? <span id={`${inputId}-help`}>{help}</span> : undefined}
      error={error}
      required={required}
      hint={hint}
      className={containerClassName}
    >
      {control}
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  help?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, help, error, hint, className, containerClassName, id, required, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [help ? `${inputId}-help` : null, error ? `${inputId}-error` : null]
    .filter(Boolean)
    .join(' ');

  const control = (
    <textarea
      ref={ref}
      id={inputId}
      rows={rows}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      className={cn(CONTROL, 'resize-y leading-relaxed', error && CONTROL_ERROR, className)}
      {...rest}
    />
  );

  if (!label) return control;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      help={help ? <span id={`${inputId}-help`}>{help}</span> : undefined}
      error={error}
      required={required}
      hint={hint}
      className={containerClassName}
    >
      {control}
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  help?: ReactNode;
  error?: string | null;
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, help, error, options, placeholder, className, containerClassName, id, required, children, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [help ? `${inputId}-help` : null, error ? `${inputId}-error` : null]
    .filter(Boolean)
    .join(' ');

  const control = (
    <select
      ref={ref}
      id={inputId}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      className={cn(CONTROL, 'pr-9', error && CONTROL_ERROR, className)}
      {...rest}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );

  if (!label) return control;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      help={help ? <span id={`${inputId}-help`}>{help}</span> : undefined}
      error={error}
      required={required}
      className={containerClassName}
    >
      {control}
    </Field>
  );
});

export function Checkbox({
  label,
  description,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex gap-2.5', className)}>
      <input
        type="checkbox"
        id={inputId}
        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
        aria-describedby={description ? `${inputId}-desc` : undefined}
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-sm text-slate-800">
          {label}
        </label>
        {description && (
          <p id={`${inputId}-desc`} className="mt-0.5 text-xs leading-relaxed text-slate-600">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function RadioGroup<T extends string>({
  name,
  legend,
  help,
  value,
  onChange,
  options,
  error,
  required,
  columns = 1,
  className,
}: {
  name: string;
  legend: ReactNode;
  help?: ReactNode;
  value: T | null;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }[];
  error?: string | null;
  required?: boolean;
  columns?: 1 | 2;
  className?: string;
}) {
  const groupId = useId();
  return (
    <fieldset className={cn('space-y-2', className)} aria-invalid={error ? true : undefined}>
      <legend className="text-sm font-medium text-slate-800">
        {legend}
        {required && <span className="ml-1 text-rose-600" title="Required">*</span>}
      </legend>
      {help && <p className="text-xs leading-relaxed text-slate-600">{help}</p>}
      <div className={cn('gap-2', columns === 2 ? 'grid sm:grid-cols-2' : 'space-y-2')}>
        {options.map((o) => {
          const optId = `${groupId}-${o.value}`;
          const selected = value === o.value;
          return (
            <label
              key={o.value}
              htmlFor={optId}
              className={cn(
                'flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 transition',
                selected
                  ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                o.disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                id={optId}
                name={name}
                value={o.value}
                checked={selected}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{o.label}</span>
                {o.description && (
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
                    {o.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-rose-700">
          <AlertCircle aria-hidden className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900"
    >
      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 pt-1', className)}>{children}</div>
  );
}
