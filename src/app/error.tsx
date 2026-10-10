"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Something went wrong
      </h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        SignalScout AI hit an unexpected error. No live provider calls were made.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="inline-flex h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Try again
      </button>
    </main>
  );
}
