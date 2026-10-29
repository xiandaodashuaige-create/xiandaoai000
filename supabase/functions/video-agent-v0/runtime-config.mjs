/** Resolve deployment-owned settings without borrowing another project's endpoints. */
export function resolveRuntimeConfig(getEnv) {
  const supabaseUrl = (getEnv("SUPABASE_URL") || "").trim();
  const publicKey = (getEnv("SUPABASE_ANON_KEY") || getEnv("SUPABASE_PUBLISHABLE_KEY") || "").trim();
  const cloudWorkerUrl = (getEnv("VIDEO_AGENT_CLOUD_WORKER_URL") || "").trim();
  function allowedUrl(value) {
    try {
      const u = new URL(value);
      return !u.username && !u.password && (u.protocol === "https:" ||
        (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
    } catch { return false; }
  }
  return {
    configured: Boolean(publicKey && allowedUrl(supabaseUrl) && (!cloudWorkerUrl || allowedUrl(cloudWorkerUrl))),
    supabaseUrl, publicKey, cloudWorkerUrl,
  };
}
