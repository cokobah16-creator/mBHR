// Supabase Storage, read as the signed-in caller (never with a service key
// and never through a public or signed URL). The storage bucket's own
// policies apply on top of the gateway's decision, exactly as for the app.
// Used only for document downloads (Binary); the file is streamed back
// through the gateway after the access has been audited.

import { errors } from "../errors/operationOutcome";
import type { FetchLike } from "./postgrest";

export interface StoredFile {
  body: ArrayBuffer;
  /** The Content-Type Storage reports, if any (not trusted as-is). */
  contentType: string | null;
  size: number;
}

export interface StorageClient {
  download(bucket: string, path: string): Promise<StoredFile | null>;
}

/** Largest file the gateway will relay (patient uploads are capped far lower). */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

const BUCKET = /^[a-z0-9-]{1,63}$/;
const SEGMENT = /^[A-Za-z0-9._ -]{1,255}$/;

/**
 * A storage object path as stored in mBHR rows: relative, "/"-separated,
 * no empty, "." or ".." segments, nothing outside a small character set.
 * Returns null for anything else, so a row can never point the gateway at
 * another folder.
 */
export function safeObjectPath(path: string): string | null {
  const segments = path.split("/");
  if (!segments.length || segments.length > 8) return null;
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === "." || s === ".." || s.trim() !== s) return null;
  }
  return segments.join("/");
}

export class SupabaseStorage implements StorageClient {
  constructor(
    private readonly opts: { supabaseUrl: string; anonKey: string; accessToken: string; fetchImpl: FetchLike },
  ) {}

  async download(bucket: string, path: string): Promise<StoredFile | null> {
    const clean = safeObjectPath(path);
    if (!BUCKET.test(bucket) || !clean) return null;
    const encoded = clean.split("/").map(encodeURIComponent).join("/");
    let res: Response;
    try {
      res = await this.opts.fetchImpl(
        `${this.opts.supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encoded}`,
        {
          method: "GET",
          headers: { apikey: this.opts.anonKey, Authorization: `Bearer ${this.opts.accessToken}` },
        },
      );
    } catch {
      throw errors.unavailable();
    }
    // Storage answers 400/404 for a missing object and 403 when its policy
    // refuses; to the caller both are "not found".
    if (res.status === 400 || res.status === 403 || res.status === 404) return null;
    if (res.status === 401) throw errors.unauthenticated("The session is not valid. Sign in again.");
    if (!res.ok) throw errors.unavailable();
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_DOWNLOAD_BYTES) throw errors.unavailable("The document is too large to download here.");
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_DOWNLOAD_BYTES) throw errors.unavailable("The document is too large to download here.");
    return { body, contentType: res.headers.get("content-type"), size: body.byteLength };
  }
}
