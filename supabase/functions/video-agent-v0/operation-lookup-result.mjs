// PostgREST expands a missing composite row into all-null columns.
// Only the complete known row shape is authoritative absence; malformed data stays invalid.
const NULL_COMPOSITE_FIELDS = [
  "id",
  "project_name",
  "brief",
  "output_count",
  "status",
  "input_files",
  "output_files",
  "progress",
  "stage",
  "error_message",
  "created_at",
  "updated_at",
  "worker_id",
  "claimed_at",
  "heartbeat_at",
  "attempt_count",
  "parent_job_id",
  "version_number",
  "revision_prompt",
  "revision_scope",
  "accepted_at",
  "video_project_id",
  "workflow_mode",
  "execution_target",
  "external_tenant_id",
  "external_project_id",
  "conversation_session_id",
  "correlation_id",
  "idempotency_key",
  "provider",
  "model",
  "estimated_cost",
  "output_sha256"
];
export function normalizeOperationLookupResult(data) {
  if (data === null) return null;
  if (data && typeof data === "object" && !Array.isArray(data) &&
      NULL_COMPOSITE_FIELDS.every((key) => Object.hasOwn(data, key)) &&
      Object.values(data).every((value) => value === null)) return null;
  return data;
}
