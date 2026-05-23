import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";

function r2EnvStatus(): { ok: true } | { ok: false; error: string } {
  const missing = [
    !process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && "CLOUDFLARE_ACCOUNT_ID",
    !process.env.R2_ACCESS_KEY_ID?.trim() && "R2_ACCESS_KEY_ID",
    !process.env.R2_SECRET_ACCESS_KEY?.trim() && "R2_SECRET_ACCESS_KEY",
  ].filter(Boolean) as string[];

  if (missing.length) {
    return { ok: false, error: `Not configured — set ${missing.join(", ")} in .env.local` };
  }
  return { ok: true };
}

let _client: S3Client | null = null;

const client = () => {
  const env = r2EnvStatus();
  if (!env.ok) throw new Error(env.error);

  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID!.trim()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      },
    });
  }
  return _client;
};

const BUCKET = () => process.env.R2_BUCKET_NAME?.trim() || "yt-downloader-corpus";

export async function uploadToR2(
  filePath: string,
  keyword: string,
  videoId: string,
  metadata: Record<string, string> = {}
): Promise<{ r2Key: string; publicUrl: string; fileSizeBytes: number }> {
  const slug = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const r2Key = `${slug}/${videoId}_${Date.now()}.mp4`;
  const fileSizeBytes = fs.statSync(filePath).size;

  await new Upload({
    client: client(),
    params: {
      Bucket: BUCKET(),
      Key: r2Key,
      Body: fs.createReadStream(filePath),
      ContentType: "video/mp4",
      ContentLength: fileSizeBytes,
      Metadata: {
        keyword,
        videoId,
        pipeline: "ytdownloader-v1",
        uploadedAt: new Date().toISOString(),
        ...metadata,
      },
    },
    queueSize: 4,
    partSize: 10 * 1024 * 1024,
  }).done();

  const domain = process.env.R2_PUBLIC_DOMAIN;
  return {
    r2Key,
    publicUrl: domain ? `https://${domain}/${r2Key}` : `r2://${BUCKET()}/${r2Key}`,
    fileSizeBytes,
  };
}

export async function pingR2() {
  const env = r2EnvStatus();
  if (!env.ok) return { ok: false as const, error: env.error, configured: false as const };

  try {
    await client().send(new HeadBucketCommand({ Bucket: BUCKET() }));
    return { ok: true as const, configured: true as const };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: message, configured: true as const };
  }
}

export async function listR2Objects(prefix?: string, maxKeys = 50) {
  const r = await client().send(
    new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix, MaxKeys: maxKeys })
  );
  return (r.Contents || []).map((o) => ({
    key: o.Key || "",
    sizeBytes: o.Size || 0,
    lastModified: o.LastModified,
  }));
}
