import { EmptyState, Panel, PlaceholderBadge } from "./Panel";

export function EvidencePlaceholder() {
  return (
    <Panel
      title="Evidence"
      description="Company facts behind each score, with their source and how well they are verified."
      badge={<PlaceholderBadge />}
    >
      <EmptyState>
        Select a prospect after a run to review the facts used to score it.
      </EmptyState>
    </Panel>
  );
}
