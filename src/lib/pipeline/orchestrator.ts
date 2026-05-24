import { searchYouTubeVideos, type YouTubeVideo } from "./youtube-search";
import {
  downloadYouTubeVideo,
  cleanupTempFile,
  cleanupTempSubtitleStem,
  type VideoQuality,
} from "./downloader";
import { uploadToR2, uploadTranscriptToR2 } from "./r2";
import { resolveDownloadConcurrency } from "./download-concurrency";
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

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldAbort: () => Promise<boolean>
): Promise<void> {
  if (!items.length) return;

  let index = 0;

  async function runWorker() {
    while (true) {
      if (await shouldAbort()) return;
      const i = index++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  }

  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
}

export async function runPipelineJob(
  jobId: string,
  keyword: string,
  opts: {
    maxResults?: number;
    quality?: VideoQuality;
    regionCode?: string;
    maxDurationSeconds?: number;
    concurrency?: number;
  } = {}
): Promise<void> {
  const {
    maxResults = 10,
    quality = "720p",
    regionCode = "US",
    maxDurationSeconds = 1200,
    concurrency,
  } = opts;
  await createJob(jobId, keyword, maxResults, quality, regionCode);

  try {
    await updateJob(jobId, { status: "searching" });
    const videos = await searchYouTubeVideos(keyword, { maxResults, regionCode, maxDurationSeconds });
    await updateJob(jobId, { status: "downloading", videos_found: videos.length });
    await runDownloadJob(jobId, keyword, videos, { quality, regionCode, skipJobCreate: true, concurrency });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, { status: "failed", error: message.slice(0, 1000) });
    throw err;
  }
}

export async function runDownloadJob(
  jobId: string,
  keyword: string,
  videos: YouTubeVideo[],
  opts: {
    quality?: VideoQuality;
    regionCode?: string;
    skipJobCreate?: boolean;
    concurrency?: number;
  } = {}
): Promise<void> {
  const { quality = "720p", regionCode = "US", skipJobCreate = false, concurrency } = opts;
  const parallel = resolveDownloadConcurrency(concurrency);

  if (!skipJobCreate) {
    await createJob(jobId, keyword, videos.length, quality, regionCode);
  }

  try {
    await updateJob(jobId, { status: "downloading", videos_found: videos.length });

    if (!videos.length) {
      await updateJob(jobId, { status: "done", completed_at: new Date().toISOString() });
      return;
    }

    await insertPendingVideos(jobId, keyword, videos);

    let downloaded = 0;
    let failed = 0;
    let totalBytes = 0;
    let statsLock = Promise.resolve();

    const syncJobStats = () => {
      statsLock = statsLock.then(async () => {
        await updateJob(jobId, {
          status: "downloading",
          videos_downloaded: downloaded,
          videos_failed: failed,
          total_size_bytes: totalBytes,
        });
      });
      return statsLock;
    };

    const processVideo = async (video: YouTubeVideo) => {
      let tmpPath: string | null = null;
      let tmpTranscriptPath: string | null = null;
      let tmpStemPath: string | null = null;

      try {
        await updateVideoStatus(jobId, video.videoId, { status: "downloading" });
        const dl = await downloadYouTubeVideo(
          video.url,
          video.videoId,
          quality,
          video.durationSeconds
        );
        tmpPath = dl.filePath;
        tmpTranscriptPath = dl.transcriptPath;
        tmpStemPath = tmpPath.replace(/\.(mp4|mkv)$/i, "");

        await updateVideoStatus(jobId, video.videoId, { status: "uploading" });
        const r2 = await uploadToR2(dl.filePath, keyword, video.videoId, {
          title: video.title.slice(0, 250),
          channel: video.channelName,
          viewCount: String(video.viewCount),
          durationSeconds: String(video.durationSeconds),
        });

        let transcriptStatus: "stored" | "missing" | "failed" = "missing";
        let transcriptPatch: Record<string, string | null> = {
          transcript_r2_key: null,
          transcript_public_url: null,
          transcript_lang: null,
        };

        if (dl.transcriptPath && dl.transcriptLang) {
          try {
            const transcript = await uploadTranscriptToR2(
              dl.transcriptPath,
              keyword,
              video.videoId,
              dl.transcriptLang,
              {
                title: video.title.slice(0, 250),
                channel: video.channelName,
              }
            );
            transcriptStatus = "stored";
            transcriptPatch = {
              transcript_r2_key: transcript.r2Key,
              transcript_public_url: transcript.publicUrl,
              transcript_lang: dl.transcriptLang,
            };
          } catch (err: unknown) {
            transcriptStatus = "failed";
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`Transcript upload failed for ${video.videoId}: ${message}`);
          }
        }

        await updateVideoStatus(jobId, video.videoId, {
          status: "stored",
          r2_key: r2.r2Key,
          r2_public_url: r2.publicUrl,
          file_size_bytes: r2.fileSizeBytes,
          transcript_status: transcriptStatus,
          ...transcriptPatch,
        });

        downloaded++;
        totalBytes += r2.fileSizeBytes;
        await syncJobStats();
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await updateVideoStatus(jobId, video.videoId, {
          status: "failed",
          error: message.slice(0, 500),
          transcript_status: "failed",
        });
        await syncJobStats();
      } finally {
        if (tmpPath) cleanupTempFile(tmpPath);
        if (tmpTranscriptPath) cleanupTempFile(tmpTranscriptPath);
        if (tmpStemPath) cleanupTempSubtitleStem(tmpStemPath);
        if (parallel === 1) {
          await jitter(2000, 5000);
        } else {
          await jitter(1000, 2500);
        }
      }
    };

    let stopRequested = false;

    await runWithConcurrency(
      videos,
      parallel,
      processVideo,
      async () => {
        if (stopRequested) return true;
        if (await shouldStop(jobId)) {
          stopRequested = true;
          return true;
        }
        return false;
      }
    );

    if (stopRequested) {
      await resetInProgressVideos(jobId);
      await updateJob(jobId, {
        status: "stopped",
        videos_downloaded: downloaded,
        videos_failed: failed,
        total_size_bytes: totalBytes,
        completed_at: new Date().toISOString(),
      });
      return;
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
