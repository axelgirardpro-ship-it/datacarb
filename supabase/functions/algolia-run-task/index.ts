// deno-lint-ignore-file no-explicit-any
// @ts-ignore: types fournis par l'environnement Edge Functions
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function runOnHosts(path: string, appId: string, apiKey: string, payload: unknown, hosts: string[]) {
  const errors: unknown[] = [];
  for (const base of hosts) {
    try {
      const url = `${base}${path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-algolia-application-id": appId,
          "x-algolia-api-key": apiKey,
          "accept": "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : { status: res.statusText }; } catch { data = { raw: text }; }
      if (res.ok) return { ok: true, host: base, status: res.status, data };
      errors.push({ host: base, status: res.status, data });
    } catch (e) {
      errors.push({ host: base, error: String(e) });
      continue;
    }
  }
  return { ok: false, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    // @ts-ignore: Deno fourni à l'exécution (Edge Functions)
    const ALGOLIA_APP_ID = (globalThis as any).Deno?.env.get("ALGOLIA_APP_ID") ?? (globalThis as any).Deno?.env.get("ALGOLIA_APPLICATION_ID") ?? "";
    // @ts-ignore
    const ALGOLIA_ADMIN_KEY = (globalThis as any).Deno?.env.get("ALGOLIA_ADMIN_KEY") ?? (globalThis as any).Deno?.env.get("ALGOLIA_WRITE_API_KEY") ?? "";
    if (!ALGOLIA_APP_ID || !ALGOLIA_ADMIN_KEY) return json(500, { error: "Algolia credentials missing in environment" });

    const body = await req.json().catch(() => ({}));
    const taskId: string = String(body?.task_id || body?.taskId || "");
    const region: string = (String(body?.region || 'eu')).toLowerCase();

    if (!taskId) return json(400, { error: "task_id required" });

    // RunTask v2 ne supporte pas parametersOverride via body, il faut configurer la query côté Task.
    const runMetadata = { runMetadata: {} };
    const path = `/2/tasks/${taskId}/run`;
    const hosts = region === 'eu' ? ["https://data.eu.algolia.com"] : ["https://data.us.algolia.com"];

    const result = await runOnHosts(path, ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY, runMetadata, hosts);
    if ((result as any).ok) {
      return json(200, {
        ok: true,
        host_used: (result as any).host,
        response: (result as any).data
      });
    }
    return json(502, { ok: false, errors: (result as any).errors });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});


