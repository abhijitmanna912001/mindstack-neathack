import type { FormEvent } from "react";
import { FormField, fieldDescriptionIds, inputClassName } from "../../_components/form/FormField";
import { LIVE_COMPANY_SIZES, LIVE_COUNTRY, type LiveCompanySize } from "../_lib/contract";
import { PREVIEW_SCENARIOS, type PreviewScenario } from "../_lib/preview";
import { CODE_MAX_LENGTH, INDUSTRY_MAX_LENGTH, type LiveFormErrors, type LiveFormValues } from "../_lib/validation";

export interface LiveFormViewProps {
  readonly values: LiveFormValues;
  readonly errors: LiveFormErrors;
  readonly submitting: boolean;
  readonly scenario: PreviewScenario;
  readonly onCodeChange: (value: string) => void;
  readonly onIndustryChange: (value: string) => void;
  readonly onSizeChange: (size: LiveCompanySize, checked: boolean) => void;
  readonly onScenarioChange: (scenario: PreviewScenario) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

// The invitation code format, as an example only: eight groups of four.
export const CODE_PLACEHOLDER = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
const CODE_HINT = `As shown in your invitation, for example ${CODE_PLACEHOLDER}.`;
const INDUSTRY_HINT = "In your own words. The live service will match it to the closest provider industry.";
const COUNTRY_HINT = "The beta covers companies in India only.";

export const SYNTHETIC_CODE_NOTE =
  "Some invitation codes are synthetic demo codes. A synthetic-mode code runs a demo on fixture companies with a fake model and ignores the industry, country and company size you submit. Live codes search Crustdata with them.";

// The live-run form. Inputs deliberately have no name attribute: even a
// native submission before the page's script loads can never put the
// invitation code (or anything else) into the URL. The page handles
// submission itself.
export function LiveFormView(props: LiveFormViewProps) {
  const { values, errors, submitting } = props;
  return (
    <form
      method="post"
      noValidate
      onSubmit={props.onSubmit}
      aria-labelledby="live-form-title"
      aria-busy={submitting}
      className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900/60"
    >
      <div className="flex flex-col gap-1">
        <h2 id="live-form-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Run a live search
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">All fields are required.</p>
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-slate-100">
        {SYNTHETIC_CODE_NOTE}
      </p>

      <FormField id="live-code" label="Invitation code" hint={CODE_HINT} error={errors.code}>
        <input
          id="live-code"
          type="text"
          value={values.code}
          onChange={(e) => props.onCodeChange(e.target.value)}
          maxLength={CODE_MAX_LENGTH}
          required
          autoComplete="off"
          placeholder={CODE_PLACEHOLDER}
          autoCapitalize="characters"
          spellCheck={false}
          disabled={submitting}
          aria-invalid={errors.code ? true : undefined}
          aria-describedby={fieldDescriptionIds("live-code", CODE_HINT, errors.code)}
          className={`${inputClassName(Boolean(errors.code))} font-mono tracking-wide`}
        />
      </FormField>

      <FormField id="live-industry" label="Industry" hint={INDUSTRY_HINT} error={errors.industry}>
        <input
          id="live-industry"
          type="text"
          value={values.industry}
          onChange={(e) => props.onIndustryChange(e.target.value)}
          maxLength={INDUSTRY_MAX_LENGTH}
          required
          autoComplete="off"
          placeholder="e.g. Staffing and recruiting"
          disabled={submitting}
          aria-invalid={errors.industry ? true : undefined}
          aria-describedby={fieldDescriptionIds("live-industry", INDUSTRY_HINT, errors.industry)}
          className={inputClassName(Boolean(errors.industry))}
        />
      </FormField>

      <FormField id="live-country" label="Country" hint={COUNTRY_HINT}>
        <select
          id="live-country"
          defaultValue={LIVE_COUNTRY}
          disabled={submitting}
          aria-describedby={fieldDescriptionIds("live-country", COUNTRY_HINT)}
          className={inputClassName(false)}
        >
          <option value={LIVE_COUNTRY}>{LIVE_COUNTRY}</option>
        </select>
      </FormField>

      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.sizes ? "live-sizes-error" : "live-sizes-hint"}
        aria-invalid={errors.sizes ? true : undefined}
        disabled={submitting}
      >
        <legend className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">Company size</legend>
        <div className="flex flex-wrap gap-3">
          {LIVE_COMPANY_SIZES.map((size) => (
            <label
              key={size}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 has-checked:border-indigo-500 has-checked:ring-1 has-checked:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <input
                type="checkbox"
                checked={values.sizes.includes(size)}
                onChange={(e) => props.onSizeChange(size, e.target.checked)}
                className="accent-indigo-600"
              />
              {size} employees
            </label>
          ))}
        </div>
        {errors.sizes ? (
          <p id="live-sizes-error" className="text-xs font-medium text-red-600 dark:text-red-400">
            {errors.sizes}
          </p>
        ) : (
          <p id="live-sizes-hint" className="text-xs text-slate-600 dark:text-slate-300">
            Select one or both.
          </p>
        )}
      </fieldset>

      <FormField
        id="live-preview-scenario"
        label="Preview: simulated server response"
        hint="Frontend preview only. Picks which synthetic response the preview shows; no request is sent."
      >
        <select
          id="live-preview-scenario"
          value={props.scenario}
          onChange={(e) => props.onScenarioChange(e.target.value as PreviewScenario)}
          disabled={submitting}
          aria-describedby="live-preview-scenario-hint"
          className={`${inputClassName(false)} border-dashed`}
        >
          {PREVIEW_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </FormField>

      <button
        type="submit"
        disabled={submitting}
        aria-disabled={submitting}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-70"
      >
        {submitting && (
          <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        )}
        {submitting ? "Running…" : "Run search (preview)"}
      </button>
    </form>
  );
}
