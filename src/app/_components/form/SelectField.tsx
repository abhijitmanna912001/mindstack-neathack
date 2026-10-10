import type { SelectHTMLAttributes } from "react";
import { FormField, fieldDescriptionIds, inputClassName } from "./FormField";

type SelectOption = { value: string; label: string };

type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "name" | "children"
> & {
  name: string;
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function SelectField({
  name,
  label,
  options,
  placeholder,
  hint,
  error,
  optional,
  ...selectProps
}: SelectFieldProps) {
  const id = `field-${name}`;
  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescriptionIds(id, hint, error)}
        className={inputClassName(Boolean(error))}
        {...selectProps}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
