export const BODY_LIMIT_BYTES = 16 * 1024;

export const ROUTES = Object.freeze({
  "/v1/milestones": Object.freeze({
    action: "add_milestone",
    kind: "milestone",
    ownerFields: Object.freeze({
      hide: "N",
      source: "public_submission",
    }),
    repositoryMethod: "createMilestone",
    validator: "milestone",
  }),
  "/v1/edit-proposals": Object.freeze({
    action: "edit_proposal",
    kind: "editProposal",
    ownerFields: Object.freeze({
      source: "public_edit_proposal",
    }),
    repositoryMethod: "createEditProposal",
    validator: "editProposal",
  }),
});

export const MILESTONE_TYPES = Object.freeze([
  "event",
  "intro",
  "move",
  "trip",
]);

export const EDIT_FIELDS = Object.freeze(["date", "description", "people"]);

export const PUBLIC_EVENT_FIELDS = Object.freeze([
  "event_id",
  "date",
  "precise",
  "event",
  "people",
  "type",
  "size",
]);

export const MILESTONE_FIELDS = Object.freeze([
  "requestId",
  "turnstileToken",
  "type",
  "date",
  "approximate",
  "description",
  "people",
  "contributorName",
  "contributorEmail",
]);

export const EDIT_PROPOSAL_FIELDS = Object.freeze([
  "requestId",
  "turnstileToken",
  "original",
  "fields",
  "requestedChange",
  "contributorName",
  "contributorEmail",
]);
