import type { InputHTMLAttributes } from "react";
import { FormField, fieldDescriptionIds, inputClassName } from "./FormField";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function TextField({
  name,
  label,
  hint,
  error,
  optional,
  ...inputProps
}: TextFieldProps) {
  const id = `field-${name}`;
  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={id}
        name={name}
        type="text"
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescriptionIds(id, hint, error)}
        className={inputClassName(Boolean(error))}
        {...inputProps}
      />
    </FormField>
  );
}
