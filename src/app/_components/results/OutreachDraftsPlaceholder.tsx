import { EmptyState, Panel, PlaceholderBadge } from "./Panel";

export function OutreachDraftsPlaceholder() {
  return (
    <Panel
      title="Outreach drafts"
      description="Drafts for qualified prospects. Nothing is sent automatically."
      badge={<PlaceholderBadge />}
    >
      <EmptyState>
        Drafts will appear here for top-tier prospects. Unverified details are
        never stated as fact.
      </EmptyState>
    </Panel>
  );
}
