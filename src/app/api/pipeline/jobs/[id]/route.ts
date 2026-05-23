import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, listVideosByJob } from "@/lib/pipeline/job-store";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [job, videos] = await Promise.all([getJob(params.id), listVideosByJob(params.id)]);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job, videos });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { status } = await req.json();
  if (status !== "stopping") {
    return NextResponse.json({ error: "Only status=stopping is supported" }, { status: 400 });
  }

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["searching", "downloading", "uploading"].includes(job.status)) {
    return NextResponse.json({ error: `Cannot stop job in status: ${job.status}` }, { status: 409 });
  }

  await updateJob(params.id, { status: "stopping" });
  return NextResponse.json({ success: true, jobId: params.id, status: "stopping" });
}
