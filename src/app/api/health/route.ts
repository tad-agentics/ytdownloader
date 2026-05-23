import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { pingR2 } from "@/lib/pipeline/r2";

type CheckStatus = "ok" | "unconfigured" | "error";

interface HealthCheck {
  status: CheckStatus;
  detail?: string;
}

function youtubeCheck(): HealthCheck {
  const key = process.env.YOUTUBE_API_KEY_1?.trim() || process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    return { status: "unconfigured", detail: "Set YOUTUBE_API_KEY_1 in .env.local" };
  }
  return { status: "ok" };
}

async function youtubePing(): Promise<HealthCheck> {
  const base = youtubeCheck();
  if (base.status !== "ok") return base;

  const key = process.env.YOUTUBE_API_KEY_1!.trim();
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=dQw4w9WgXcQ&key=${key}`
    );
    if (r.ok) return { status: "ok", detail: "HTTP 200" };
    return { status: "error", detail: `HTTP ${r.status}` };
  } catch (e: unknown) {
    return { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

function supabaseCheck(): HealthCheck {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !key && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    return {
      status: "unconfigured",
      detail: `Set ${missing.join(", ")} in .env.local`,
    };
  }
  return { status: "ok" };
}

async function supabasePing(): Promise<HealthCheck> {
  const base = supabaseCheck();
  if (base.status !== "ok") return base;

  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await db.from("pipeline_jobs").select("id", { count: "exact", head: true });
    if (error) return { status: "error", detail: error.message };
    return { status: "ok", detail: "connected" };
  } catch (e: unknown) {
    return { status: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const checks: Record<string, HealthCheck> = {};

  try {
    const ver = execSync("yt-dlp --version", { timeout: 5000 }).toString().trim();
    checks.ytdlp = { status: "ok", detail: ver };
  } catch (e: unknown) {
    checks.ytdlp = {
      status: "error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  checks.supabase = await supabasePing();
  checks.youtubeApi = await youtubePing();

  const r2 = await pingR2();
  checks.r2 = r2.ok
    ? { status: "ok" }
    : r2.configured === false
      ? { status: "unconfigured", detail: r2.error }
      : { status: "error", detail: r2.error };

  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const pipelineReady = checks.ytdlp?.status === "ok" && checks.supabase?.status === "ok";

  return NextResponse.json(
    { ok: allOk, pipelineReady, checks },
    { status: pipelineReady ? 200 : 503 }
  );
}
