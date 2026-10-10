import { companySizeLabel, type IcpDraft } from "../../_lib/icp-form";

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <span className="text-sm text-slate-500 dark:text-slate-400">{empty}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="max-w-full truncate rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function IcpSummary({ icp }: { icp: IcpDraft }) {
  const rows = [
    { label: "Industry", value: <Chips items={[icp.industry]} empty="—" /> },
    {
      label: "Company size",
      value: <Chips items={[companySizeLabel(icp.companySize)]} empty="—" />,
    },
    { label: "Location", value: <Chips items={icp.locations} empty="Any location" /> },
    { label: "Keywords", value: <Chips items={icp.keywords} empty="None" /> },
    { label: "Excluded", value: <Chips items={icp.excludedDomains} empty="None" /> },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-x-4">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 sm:pt-0.5 dark:text-slate-400">
            {row.label}
          </dt>
          <dd className="min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
