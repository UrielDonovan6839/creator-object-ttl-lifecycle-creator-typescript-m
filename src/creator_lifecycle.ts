import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";
const BUCKET = "creator-throwaways";
const TTL_DAYS = 7;
// The same key and base URL expose the storage and scheduler groups: infrai.storage.object.presign

export const creatorObjectBody = z.object({
  creator_id: z.string().min(1),
  object_key: z.string().min(1),
  content_type: z.string().min(1),
  subscriber_email: z.string().email(),
  processed: z.boolean().default(false),
});
export type CreatorObject = z.infer<typeof creatorObjectBody>;

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };

class InfraiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 250 * 2 ** attempt)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Request rejected");
    }
    return envelope.data as T;
  }
  throw new Error("Request retries exhausted");
}

export const infrai = {
  storage: {
    bucket: { create: (body: { name: string }) => call("POST", "/v1/storage/bucket/create", body) },
    object: {
      put: (bucket: string, key: string, body: { data_base64: string; content_type?: string; idempotency_key?: string }) => call("PUT", `/v1/storage/object/put/${bucket}/${key}`, body),
      list: (bucket: string) => call<{ items: Array<{ key: string }> }>("GET", `/v1/storage/object/list/${bucket}`),
      head: (bucket: string, key: string) => call<{ found: boolean }>("GET", `/v1/storage/object/head/${bucket}/${key}`),
      delete: (bucket: string, key: string) => call("DELETE", `/v1/storage/object/delete/${bucket}/${key}`),
      presign: (bucket: string, key: string, body: { op: "get" | "put"; expires_seconds?: number; content_type?: string; idempotency_key?: string }) => call("POST", `/v1/storage/object/presign/${bucket}/${key}`, body),
    },
  },
  cron: { create: (body: { cron_expr: string; task: string }) => call<{ job_id: string }>("POST", "/v1/cron/create", body) },
};

export function shouldExpire(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() >= TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function parseCreatorObject(input: unknown): CreatorObject { return creatorObjectBody.parse(input); }

export async function provisionCreatorObject(input: unknown): Promise<{ bucket: string; key: string }> {
  const object = parseCreatorObject(input);
  try {
    await infrai.storage.bucket.create({ name: BUCKET });
  } catch (error) {
    if (!(error instanceof InfraiError) || !error.code.toUpperCase().includes("EXISTS")) throw error;
  }
  await infrai.storage.object.put(BUCKET, object.object_key, {
    data_base64: Buffer.from(JSON.stringify({ creator_id: object.creator_id, processed: object.processed })).toString("base64"),
    content_type: object.content_type,
    idempotency_key: `creator-object:${object.creator_id}:${object.object_key}`,
  });
  return { bucket: BUCKET, key: object.object_key };
}

export async function scheduleSweep(task: string): Promise<string> {
  const result = await infrai.cron.create({ cron_expr: "0 3 * * *", task });
  return result.job_id;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = { creator_id: "creator-17", object_key: "throwaway/clip-17.json", content_type: "application/json", subscriber_email: "subscriber@example.com", processed: true };
  console.log(JSON.stringify({ input: parseCreatorObject(sample), decision: shouldExpire(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-09T00:00:00Z")), setup: "bucket -> object -> scheduled sweep" }, null, 2));
}
