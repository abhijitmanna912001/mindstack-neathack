import {
  COMPANY_SIZE_OPTIONS,
  ICP_LIMITS,
  INDUSTRY_SUGGESTIONS,
  type IcpFormState,
} from "../_lib/icp-form";
import { DataModeSelector } from "./form/DataModeSelector";
import { SelectField } from "./form/SelectField";
import { TextAreaField } from "./form/TextAreaField";
import { TextField } from "./form/TextField";

type IcpFormProps = {
  action: (formData: FormData) => void;
  state: IcpFormState;
  pending: boolean;
};

export function IcpForm({ action, state, pending }: IcpFormProps) {
  const { values } = state;
  const errors = state.status === "invalid" ? state.errors : {};

  return (
    <form
      action={action}
      noValidate
      aria-labelledby="icp-form-title"
      className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900/60"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="icp-form-title"
          className="text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          Ideal customer profile
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Describe the companies you want to find. Separate multiple values with
          commas or new lines.
        </p>
      </div>

      <TextField
        name="industry"
        label="Target industry"
        placeholder="e.g. Software / SaaS"
        list="industry-suggestions"
        maxLength={ICP_LIMITS.industryMaxLength}
        autoComplete="off"
        required
        defaultValue={values.industry}
        error={errors.industry}
      />
      <datalist id="industry-suggestions">
        {INDUSTRY_SUGGESTIONS.map((industry) => (
          <option key={industry} value={industry} />
        ))}
      </datalist>

      {/* React only applies a select's defaultValue on mount, so remount it
          when the submitted value changes; otherwise the post-action form
          reset drops the user's choice. */}
      <SelectField
        key={values.companySize}
        name="companySize"
        label="Company size"
        placeholder="Select a headcount range"
        options={COMPANY_SIZE_OPTIONS}
        required
        defaultValue={values.companySize}
        error={errors.companySize}
      />

      <TextField
        name="location"
        label="Location"
        placeholder="e.g. United Kingdom, Germany"
        hint="Countries or regions. Leave blank for any location."
        optional
        autoComplete="off"
        defaultValue={values.location}
        error={errors.location}
      />

      <TextAreaField
        name="keywords"
        label="Target company keywords"
        placeholder="e.g. payments API, compliance automation"
        hint="Products, technologies or themes the company should match."
        optional
        defaultValue={values.keywords}
        error={errors.keywords}
      />

      <TextAreaField
        name="excludedDomains"
        label="Excluded domains"
        placeholder={"e.g. competitor.com\nexisting-customer.io"}
        hint="Companies to skip, such as current customers or competitors."
        optional
        spellCheck={false}
        defaultValue={values.excludedDomains}
        error={errors.excludedDomains}
      />

      <DataModeSelector defaultValue={values.mode} error={errors.mode} />

      {state.status === "invalid" && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-70"
      >
        {pending && (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        {pending ? "Checking profile…" : "Find prospects"}
      </button>
    </form>
  );
}
