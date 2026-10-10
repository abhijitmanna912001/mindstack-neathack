type DataModeSelectorProps = {
  defaultValue: string;
  error?: string;
};

// Synthetic data is the only selectable mode. The live option is shown for
// context but stays disabled; the Server Action also rejects it, so enabling
// the radio in the browser does not unlock paid Crustdata calls.
export function DataModeSelector({ defaultValue, error }: DataModeSelectorProps) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? "field-mode-error" : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
        Data source
      </legend>

      <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-300 bg-white p-3 has-checked:border-indigo-500 has-checked:bg-indigo-50/60 has-checked:ring-1 has-checked:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:has-checked:bg-indigo-500/10">
        <input
          type="radio"
          name="mode"
          value="synthetic"
          defaultChecked={defaultValue !== "live"}
          className="mt-0.5 accent-indigo-600"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Synthetic data
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Generated demo companies. No API calls and no credits spent.
          </span>
        </span>
      </label>

      <label className="flex cursor-not-allowed gap-3 rounded-lg border border-dashed border-slate-300 p-3 opacity-60 dark:border-slate-700">
        <input
          type="radio"
          name="mode"
          value="live"
          disabled
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Live Crustdata
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Uses paid credits. Requires operator access and is not enabled in
            this build.
          </span>
        </span>
      </label>

      {error && (
        <p id="field-mode-error" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </fieldset>
  );
}
