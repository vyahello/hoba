import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from "react";

import { cn } from "@/lib/cn";

interface CommonFieldProps {
  label: string;
  error?: string;
  hint?: string;
  /** When set, shows `value.length / counter` next to the label. */
  counter?: number;
  className?: string;
}

export interface InputProps
  extends CommonFieldProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {}

export interface TextareaProps
  extends CommonFieldProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {}

function fieldClasses(error: string | undefined): string {
  return cn(
    "w-full rounded-md bg-surface-light-2 dark:bg-surface-dark-2",
    "px-4 py-3 text-base font-ui",
    "text-ink-light-1 dark:text-ink-dark-1",
    "placeholder:text-ink-light-2 dark:placeholder:text-ink-dark-2",
    "border-2 border-transparent",
    "focus:border-brand-primary focus:outline-none",
    error && "border-state-danger",
  );
}

function HeaderRow({
  label,
  htmlFor,
  current,
  counter,
}: {
  label: string;
  htmlFor: string;
  current: number;
  counter?: number;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2"
      >
        {label}
      </label>
      {counter !== undefined && (
        <span
          className={cn(
            "text-xs font-mono tabular-nums",
            current > counter ? "text-state-danger" : "text-ink-light-2 dark:text-ink-dark-2",
          )}
        >
          {current}/{counter}
        </span>
      )}
    </div>
  );
}

function Footer({ error, hint }: { error?: string; hint?: string }): JSX.Element | null {
  if (error === undefined && hint === undefined) return null;
  return (
    <p
      className={cn(
        "mt-1.5 text-xs",
        error !== undefined
          ? "text-state-danger"
          : "text-ink-light-2 dark:text-ink-dark-2",
      )}
      role={error !== undefined ? "alert" : undefined}
    >
      {error ?? hint}
    </p>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, counter, className, value, defaultValue, onChange, ...rest },
  ref,
) {
  const id = useId();
  const [internal, setInternal] = useState(
    typeof defaultValue === "string" ? defaultValue : "",
  );
  const current = (typeof value === "string" ? value : internal).length;

  return (
    <div className={cn("w-full", className)}>
      <HeaderRow label={label} htmlFor={id} current={current} counter={counter} />
      <input
        ref={ref}
        id={id}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          if (value === undefined) setInternal(event.target.value);
          onChange?.(event);
        }}
        aria-invalid={error !== undefined || undefined}
        className={fieldClasses(error)}
        {...rest}
      />
      <Footer error={error} hint={hint} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, counter, className, value, defaultValue, onChange, rows = 4, ...rest },
  ref,
) {
  const id = useId();
  const [internal, setInternal] = useState(
    typeof defaultValue === "string" ? defaultValue : "",
  );
  const current = (typeof value === "string" ? value : internal).length;

  return (
    <div className={cn("w-full", className)}>
      <HeaderRow label={label} htmlFor={id} current={current} counter={counter} />
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          if (value === undefined) setInternal(event.target.value);
          onChange?.(event);
        }}
        aria-invalid={error !== undefined || undefined}
        className={cn(fieldClasses(error), "resize-none")}
        {...rest}
      />
      <Footer error={error} hint={hint} />
    </div>
  );
});
