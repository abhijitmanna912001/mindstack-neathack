import type { TextareaHTMLAttributes } from "react";
import { FormField, fieldDescriptionIds, inputClassName } from "./FormField";

type TextAreaFieldProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "name"
> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function TextAreaField({
  name,
  label,
  hint,
  error,
  optional,
  rows = 3,
  ...textareaProps
}: TextAreaFieldProps) {
  const id = `field-${name}`;
  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescriptionIds(id, hint, error)}
        className={`${inputClassName(Boolean(error))} resize-y`}
        {...textareaProps}
      />
    </FormField>
  );
}
