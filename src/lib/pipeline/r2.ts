import { S3Client, HeadBucketCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
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

const BUCKET = () => process.env.R2_BUCKET_NAME?.trim() || "ytdownloader";

/** S3/R2 user metadata is sent as HTTP headers — values must be printable ASCII. */
function sanitizeMetadataValue(value: string, maxLen = 256): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\r\n\x00-\x1f\x7f]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return ascii || "unknown";
}

function sanitizeMetadata(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = sanitizeMetadataValue(value, key === "title" ? 200 : 128);
  }
  return out;
}

function keywordSlug(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function uploadToR2(
  filePath: string,
  keyword: string,
  videoId: string,
  metadata: Record<string, string> = {}
): Promise<{ r2Key: string; publicUrl: string; fileSizeBytes: number }> {
  const slug = keywordSlug(keyword);
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
      Metadata: sanitizeMetadata({
        keyword,
        videoId,
        pipeline: "ytdownloader-v1",
        uploadedAt: new Date().toISOString(),
        ...metadata,
      }),
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

export async function uploadTranscriptToR2(
  filePath: string,
  keyword: string,
  videoId: string,
  lang: string,
  metadata: Record<string, string> = {}
): Promise<{ r2Key: string; publicUrl: string; fileSizeBytes: number }> {
  const slug = keywordSlug(keyword);
  const safeLang = lang.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 16) || "und";
  const r2Key = `${slug}/${videoId}_${Date.now()}.${safeLang}.srt`;
  const fileSizeBytes = fs.statSync(filePath).size;

  await new Upload({
    client: client(),
    params: {
      Bucket: BUCKET(),
      Key: r2Key,
      Body: fs.createReadStream(filePath),
      ContentType: "text/plain; charset=utf-8",
      ContentLength: fileSizeBytes,
      Metadata: sanitizeMetadata({
        keyword,
        videoId,
        lang: safeLang,
        type: "transcript",
        pipeline: "ytdownloader-v1",
        uploadedAt: new Date().toISOString(),
        ...metadata,
      }),
    },
    queueSize: 2,
    partSize: 5 * 1024 * 1024,
  }).done();

  const domain = process.env.R2_PUBLIC_DOMAIN;
  return {
    r2Key,
    publicUrl: domain ? `https://${domain}/${r2Key}` : `r2://${BUCKET()}/${r2Key}`,
    fileSizeBytes,
  };
}

export async function getR2StorageStats(): Promise<{ totalBytes: number; objectCount: number }> {
  let totalBytes = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;

  do {
    const r = await client().send(
      new ListObjectsV2Command({
        Bucket: BUCKET(),
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );
    for (const o of r.Contents || []) {
      totalBytes += o.Size || 0;
      objectCount += 1;
    }
    continuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (continuationToken);

  return { totalBytes, objectCount };
}

export async function deleteR2Objects(keys: string[]): Promise<string[]> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (!unique.length) return [];

  await client().send(
    new DeleteObjectsCommand({
      Bucket: BUCKET(),
      Delete: {
        Objects: unique.map((Key) => ({ Key })),
        Quiet: true,
      },
    })
  );

  return unique;
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
