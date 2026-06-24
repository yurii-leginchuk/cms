// Shared chat proposal types. Moved here (neutral module) when the FloatingChat
// mini-widget was removed, so SiteChat no longer imports from a deleted component.

export interface AgentMetaProposal {
  pageId: string
  pageUrl: string
  currentTitle: string | null
  currentDescription: string | null
  proposedTitle: string | null
  proposedDescription: string | null
  reasoning: string
}
