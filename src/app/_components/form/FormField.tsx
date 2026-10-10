import type { ReactNode } from "react";

type FormFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
};

export function fieldDescriptionIds(id: string, hint?: string, error?: string) {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function inputClassName(hasError: boolean) {
  return [
    "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-xs",
    "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0",
    "dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500",
    hasError
      ? "border-red-400 focus:border-red-500 focus:ring-red-500/30 dark:border-red-500/70"
      : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/30 dark:border-slate-700",
  ].join(" ");
}

export function FormField({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {label}
        {optional && (
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            Optional
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
