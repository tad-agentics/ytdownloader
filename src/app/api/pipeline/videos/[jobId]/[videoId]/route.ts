import { NextRequest, NextResponse } from "next/server";
import { deleteVideoRecord, getJob, getVideo, updateJob } from "@/lib/pipeline/job-store";
import { deleteR2Objects } from "@/lib/pipeline/r2";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { jobId: string; videoId: string } }
) {
  const { jobId, videoId } = params;

  const video = await getVideo(jobId, videoId);
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (video.status !== "stored") {
    return NextResponse.json({ error: "Only stored videos can be deleted" }, { status: 400 });
  }

  const keys = [video.r2_key, video.transcript_r2_key].filter(Boolean) as string[];
  const deletedKeys = await deleteR2Objects(keys);

  const job = await getJob(jobId);
  if (job) {
    await updateJob(jobId, {
      videos_downloaded: Math.max(0, job.videos_downloaded - 1),
      total_size_bytes: Math.max(
        0,
        Number(job.total_size_bytes) - Number(video.file_size_bytes)
      ),
    });
  }

  await deleteVideoRecord(jobId, videoId);

  return NextResponse.json({ ok: true, deletedKeys });
}
