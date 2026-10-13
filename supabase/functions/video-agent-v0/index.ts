import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PUBLIC_KEY = "sb_publishable_41p3q4WMtJH85KjAPu06fw_JY3UO8XQ";
const INPUT_BUCKET = "video-agent-inputs";
const RESULT_BUCKET = "video-agent-results";
const EXPECTED_DIGEST = Deno.env.get("VIDEO_AGENT_ACCESS_DIGEST") ?? "";
const CLOUD_WORKER_URL = "https://www.xiandaoai.com/api/video-worker";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-video-access",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
async function accessMatches(access: string): Promise<boolean> {
  const expected = hexToBytes(EXPECTED_DIGEST);
  if (!expected) return false;

  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(access)),
  );
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}
function errMsg(error: any) {
  return error?.message || error?.details || error?.hint || "request_failed";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const access = req.headers.get("x-video-access") || body.access_code || "";
  if (!access || !(await accessMatches(access))) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "https://ejspsxjeelhsevldmnhl.supabase.co";
  const sb = createClient(url, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const action = String(body.action || "");

  try {
    if (action === "auth") {
      const { data, error } = await sb.rpc("video_agent_check_access", { p_access: access });
      if (error) return json({ error: errMsg(error) }, 500);
      return data === true ? json({ ok: true }) : json({ error: "unauthorized" }, 401);
    }

    if (action === "list_projects") {
      const { data, error } = await sb.rpc("video_agent_list_projects", { p_access: access });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, projects: data || [] });
    }

    if (action === "get_project") {
      const { data, error } = await sb.rpc("video_agent_get_project", {
        p_access: access,
        p_project_id: String(body.project_id || ""),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, project: data });
    }

    if (action === "create_project" || action === "update_project") {
      const params: Record<string, unknown> = {
        p_access: access,
        p_project_name: String(body.project_name || ""),
        p_client_name: String(body.client_name || ""),
        p_business_type: String(body.business_type || ""),
        p_business_summary: String(body.business_summary || ""),
        p_target_audience: String(body.target_audience || ""),
        p_offer_facts: String(body.offer_facts || ""),
        p_cta: String(body.cta || ""),
        p_default_language: String(body.default_language || "普通话"),
        p_must_include: String(body.must_include || ""),
        p_must_exclude: String(body.must_exclude || ""),
      };
      if (action === "update_project") params.p_project_id = String(body.project_id || "");
      const { data, error } = await sb.rpc(
        action === "create_project" ? "video_agent_create_project" : "video_agent_update_project",
        params,
      );
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, project: data });
    }

    if (action === "provider_upsert_project") {
      const { data, error } = await sb.rpc("video_agent_provider_upsert_project", {
        p_access: access,
        p_tenant_id: String(body.tenant_id || ""),
        p_external_project_id: String(body.project_id || ""),
        p_project_name: String(body.project_name || ""),
        p_client_name: String(body.client_name || ""),
        p_business_type: String(body.business_type || ""),
        p_business_summary: String(body.business_summary || ""),
        p_target_audience: String(body.target_audience || ""),
        p_offer_facts: String(body.offer_facts || ""),
        p_cta: String(body.cta || ""),
        p_default_language: String(body.default_language || "普通话"),
        p_must_include: String(body.must_include || ""),
        p_must_exclude: String(body.must_exclude || ""),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, project: data });
    }

    if (action === "provider_init_job") {
      const { data, error } = await sb.rpc("video_agent_provider_create_job", {
        p_access: access,
        p_tenant_id: String(body.tenant_id || ""),
        p_external_project_id: String(body.project_id || ""),
        p_conversation_session_id: String(body.conversation_session_id || ""),
        p_correlation_id: String(body.correlation_id || ""),
        p_idempotency_key: String(body.idempotency_key || ""),
        p_brief: String(body.brief || ""),
        p_workflow_mode: String(body.workflow_mode || "ai_hybrid"),
        p_output_count: Number(body.output_count || 1),
        p_provider: body.provider ? String(body.provider) : null,
        p_model: body.model ? String(body.model) : null,
        p_estimated_cost: body.estimated_cost == null ? null : Number(body.estimated_cost),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, job: data });
    }

    if (action === "provider_status") {
      const { data, error } = await sb.rpc("video_agent_provider_get_job", {
        p_access: access,
        p_tenant_id: String(body.tenant_id || ""),
        p_external_project_id: String(body.project_id || ""),
        p_job_id: String(body.job_id || ""),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, job: data });
    }

    if (action === "provider_sign_upload") {
      const tenantId = String(body.tenant_id || "");
      const projectId = String(body.project_id || "");
      const jobId = String(body.job_id || "");
      const { data: scopedJob, error: scopeError } = await sb.rpc("video_agent_provider_get_job", {
        p_access: access, p_tenant_id: tenantId, p_external_project_id: projectId, p_job_id: jobId,
      });
      if (scopeError || !scopedJob?.id) return json({ error: errMsg(scopeError) }, 404);
      const { data, error } = await sb.rpc("video_agent_issue_path", {
        p_access: access, p_job_id: jobId, p_bucket: INPUT_BUCKET, p_file_name: String(body.file_name || "file"),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, bucket: INPUT_BUCKET, path: data, content_type: String(body.content_type || "application/octet-stream") });
    }

    if (action === "provider_submit_job") {
      const tenantId = String(body.tenant_id || "");
      const projectId = String(body.project_id || "");
      const jobId = String(body.job_id || "");
      const { data: scopedJob, error: scopeError } = await sb.rpc("video_agent_provider_get_job", {
        p_access: access, p_tenant_id: tenantId, p_external_project_id: projectId, p_job_id: jobId,
      });
      if (scopeError || !scopedJob?.id) return json({ error: errMsg(scopeError) }, 404);
      const { data, error } = await sb.rpc("video_agent_submit_job", {
        p_access: access, p_job_id: jobId, p_input_files: Array.isArray(body.input_files) ? body.input_files : [],
      });
      if (error) return json({ error: errMsg(error) }, 500);
      if (data?.execution_target === "cloud") {
        EdgeRuntime.waitUntil(fetch(CLOUD_WORKER_URL, {
          method: "POST", headers: { "Content-Type": "application/json", "x-video-access": access },
          body: JSON.stringify({ source: "provider_submit_job", job_id: data.id }),
        }).catch((error) => console.error("cloud_worker_trigger_failed", errMsg(error))));
      }
      return json({ ok: true, job: data });
    }

    if (action === "provider_download_url") {
      const tenantId = String(body.tenant_id || "");
      const projectId = String(body.project_id || "");
      const jobId = String(body.job_id || "");
      const bucket = String(body.bucket || "");
      const objectPath = String(body.path || "");
      if (![INPUT_BUCKET, RESULT_BUCKET].includes(bucket)) return json({ error: "invalid_bucket" }, 400);
      const { data: scopedJob, error: scopeError } = await sb.rpc("video_agent_provider_get_job", {
        p_access: access, p_tenant_id: tenantId, p_external_project_id: projectId, p_job_id: jobId,
      });
      if (scopeError || !scopedJob?.id) return json({ error: errMsg(scopeError) }, 404);
      const allowedFiles = [...(Array.isArray(scopedJob.input_files) ? scopedJob.input_files : []), ...(Array.isArray(scopedJob.output_files) ? scopedJob.output_files : [])];
      if (!allowedFiles.some((file: any) => String(file?.path || "") === objectPath)) return json({ error: "path_not_in_scoped_job" }, 403);
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(objectPath, 3600);
      if (error || !data?.signedUrl) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, url: data.signedUrl });
    }

    if (action === "init_job") {
      const projectId = String(body.video_project_id || "");
      const rpc = projectId ? "video_agent_create_project_job" : "video_agent_create_job";
      const params = projectId ? {
        p_access: access,
        p_video_project_id: projectId,
        p_project_name: String(body.project_name || ""),
        p_brief: String(body.brief || ""),
        p_output_count: Number(body.output_count || 1),
        p_workflow_mode: String(body.workflow_mode || "remix"),
      } : {
        p_access: access,
        p_project_name: String(body.project_name || ""),
        p_brief: String(body.brief || ""),
        p_output_count: Number(body.output_count || 1),
      };
      const { data, error } = await sb.rpc(rpc, params);
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, job: data });
    }

    if (action === "list_jobs") {
      const projectId = String(body.video_project_id || "");
      const { data, error } = projectId
        ? await sb.rpc("video_agent_list_project_jobs", { p_access: access, p_video_project_id: projectId })
        : await sb.rpc("video_agent_list_jobs", { p_access: access });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, jobs: data || [] });
    }

    if (action === "record_feedback") {
      const { data, error } = await sb.rpc("video_agent_record_feedback", {
        p_access: access,
        p_video_project_id: String(body.video_project_id || ""),
        p_job_id: body.job_id ? String(body.job_id) : null,
        p_actor_id: String(body.actor_id || "employee"),
        p_event_type: String(body.event_type || "operation"),
        p_content: String(body.content || ""),
        p_metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, feedback: data });
    }

    if (action === "list_feedback") {
      const { data, error } = await sb.rpc("video_agent_list_project_feedback", {
        p_access: access,
        p_video_project_id: String(body.video_project_id || ""),
        p_limit: Math.max(1, Math.min(100, Number(body.limit || 30))),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, feedback: data || [] });
    }

    if (action === "status" || action === "worker_job") {
      const { data, error } = await sb.rpc("video_agent_get_job", { p_access: access, p_job_id: String(body.job_id || "") });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, job: data });
    }

    if (action === "download_url") {
      const bucket = String(body.bucket || "");
      const path = String(body.path || "");
      if (![INPUT_BUCKET, RESULT_BUCKET].includes(bucket)) return json({ error: "invalid_bucket" }, 400);
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, url: data.signedUrl });
    }

    if (action === "sign_upload" || action === "sign_result_upload") {
      const bucket = action === "sign_upload" ? INPUT_BUCKET : RESULT_BUCKET;
      const { data, error } = await sb.rpc("video_agent_issue_path", {
        p_access: access,
        p_job_id: String(body.job_id || ""),
        p_bucket: bucket,
        p_file_name: String(body.file_name || (bucket === RESULT_BUCKET ? "result.mp4" : "file")),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, bucket, path: data, content_type: String(body.content_type || "application/octet-stream") });
    }

    if (action === "submit_job") {
      const { data, error } = await sb.rpc("video_agent_submit_job", {
        p_access: access,
        p_job_id: String(body.job_id || ""),
        p_input_files: Array.isArray(body.input_files) ? body.input_files : [],
      });
      if (error) return json({ error: errMsg(error) }, 500);
      if (data?.execution_target === "cloud") {
        EdgeRuntime.waitUntil(fetch(CLOUD_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-video-access": access },
          body: JSON.stringify({ source: "submit_job", job_id: data.id }),
        }).catch((error) => console.error("cloud_worker_trigger_failed", errMsg(error))));
      }
      return json({ ok: true, job: data });
    }

    if (action === "create_revision") {
      const { data, error } = await sb.rpc("video_agent_create_revision", {
        p_access: access,
        p_parent_job_id: String(body.parent_job_id || ""),
        p_revision_prompt: String(body.revision_prompt || ""),
        p_revision_scope: String(body.revision_scope || "auto"),
      });
      if (error) return json({ error: errMsg(error) }, 500);
      if (data?.execution_target === "cloud") {
        EdgeRuntime.waitUntil(fetch(CLOUD_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-video-access": access },
          body: JSON.stringify({ source: "create_revision", job_id: data.id }),
        }).catch((error) => console.error("cloud_worker_trigger_failed", errMsg(error))));
      }
      return json({ ok: true, job: data });
    }

    if (action === "accept_job") {
      const { data, error } = await sb.rpc("video_agent_accept_job", { p_access: access, p_job_id: String(body.job_id || "") });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, job: data });
    }

    if (action === "worker_update") {
      const { data, error } = await sb.rpc("video_agent_worker_update", {
        p_access: access,
        p_job_id: String(body.job_id || ""),
        p_status: body.status ?? null,
        p_progress: body.progress ?? null,
        p_stage: body.stage ?? null,
        p_output_files: body.output_files ?? null,
        p_error_message: body.error_message ?? null,
      });
      if (error) return json({ error: errMsg(error) }, 500);
      return json({ ok: true, job: data });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    return json({ error: errMsg(error) }, 500);
  }
});
