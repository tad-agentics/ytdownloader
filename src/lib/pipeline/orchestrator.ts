import { searchYouTubeVideos } from "./youtube-search";
import { downloadYouTubeVideo, cleanupTempFile, type VideoQuality } from "./downloader";
import { uploadToR2 } from "./r2";
import {
  createJob,
  updateJob,
  getJob,
  insertPendingVideos,
  updateVideoStatus,
  resetInProgressVideos,
} from "./job-store";

const jitter = (lo: number, hi: number) =>
  new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));

async function shouldStop(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  return job?.status === "stopping";
}

export async function runPipelineJob(
  jobId: string,
  keyword: string,
  opts: { maxResults?: number; quality?: VideoQuality; regionCode?: string } = {}
): Promise<void> {
  const { maxResults = 10, quality = "720p", regionCode = "VN" } = opts;
  await createJob(jobId, keyword, maxResults, quality, regionCode);

  try {
    await updateJob(jobId, { status: "searching" });
    const videos = await searchYouTubeVideos(keyword, { maxResults, regionCode });
    await updateJob(jobId, { status: "downloading", videos_found: videos.length });

    if (!videos.length) {
      await updateJob(jobId, { status: "done", completed_at: new Date().toISOString() });
      return;
    }

    await insertPendingVideos(jobId, keyword, videos);

    let downloaded = 0;
    let failed = 0;
    let totalBytes = 0;

    for (const video of videos) {
      if (await shouldStop(jobId)) {
        await resetInProgressVideos(jobId);
        await updateJob(jobId, { status: "stopped", completed_at: new Date().toISOString() });
        return;
      }

      let tmpPath: string | null = null;
      try {
        await updateVideoStatus(jobId, video.videoId, { status: "downloading" });
        const dl = await downloadYouTubeVideo(video.url, video.videoId, quality);
        tmpPath = dl.filePath;

        await updateJob(jobId, { status: "uploading" });
        await updateVideoStatus(jobId, video.videoId, { status: "uploading" });
        const r2 = await uploadToR2(dl.filePath, keyword, video.videoId, {
          title: video.title.slice(0, 250),
          channel: video.channelName,
          viewCount: String(video.viewCount),
          durationSeconds: String(video.durationSeconds),
        });

        await updateVideoStatus(jobId, video.videoId, {
          status: "stored",
          r2_key: r2.r2Key,
          r2_public_url: r2.publicUrl,
          file_size_bytes: r2.fileSizeBytes,
        });

        downloaded++;
        totalBytes += r2.fileSizeBytes;
        await updateJob(jobId, {
          status: "downloading",
          videos_downloaded: downloaded,
          total_size_bytes: totalBytes,
        });
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await updateVideoStatus(jobId, video.videoId, {
          status: "failed",
          error: message.slice(0, 500),
        });
        await updateJob(jobId, { videos_failed: failed });
      } finally {
        if (tmpPath) cleanupTempFile(tmpPath);
        await jitter(2000, 5000);
      }
    }

    await updateJob(jobId, {
      status: "done",
      videos_downloaded: downloaded,
      videos_failed: failed,
      total_size_bytes: totalBytes,
      completed_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, { status: "failed", error: message.slice(0, 1000) });
    throw err;
  }
}
