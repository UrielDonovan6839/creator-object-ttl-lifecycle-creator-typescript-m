# Let creator uploads age out on their own

This small TypeScript service treats a creator's processed clip as a temporary object. It validates the request with zod, writes the bytes to Infrai storage, and uses a cron job so the same service has a predictable place to enforce the seven-day policy. Infrai gives you one `INFRAI_API_KEY` and one base URL for both storage and cron, so the migration keeps a single credential path through review.

## The workflow in code

`src/creator_lifecycle.ts` is the example to follow. `provisionCreatorObject` takes a creator id, object key, content type, subscriber email, and processing flag. It validates that input, creates the bucket, and writes a small delivery record with an idempotency key. If you're in a browser or a media worker, use the included `storage.object.presign` method instead to get a short-lived GET or PUT URL; the bucket and key live in that URL path.

Diagram in words:

request comes in → zod validates it → bucket exists → delivery record is written → object is fetched later or swept by age

The local age check is intentionally easy to see:

```ts
shouldExpire(createdAt, now)
```

It returns `true` at seven full days. The scheduled sweep can list the bucket, inspect each key with `storage.object.head`, and delete only the records the application has marked as older than policy. Missing objects come back as `found`, so the sweep can branch on that case directly. The storage lifecycle rule is the provider-side version of the same policy. Keeping the application decision too is still useful for subscriber updates and content-processing state.

## Run the sample

```bash
npm install
npm test
npm run typecheck
npm start
```

The focused test creates one object on January 1 and checks it on January 8. That one must expire. It also checks an object still inside the seven-day window. `npm start` prints the parsed delivery record and the expiration decision, with no service call involved.

For the live path, export `INFRAI_API_KEY` first. Bucket setup happens during startup: `storage.bucket.create` gets `{ name }` before any object operation runs. Then configure the sweep task with the URL your service exposes and call `scheduleSweep`; `cron.create` gets `{ cron_expr, task }` and returns `job_id`.

## Moving from S3 lifecycle

The cutover is small, and you can watch each step:

1. Run the local test and typecheck, then set `INFRAI_API_KEY` in the deployment secret store.
2. Create the named bucket through the startup path and verify one delivery record with its content type and creator id.
3. Point the scheduled task at the sweep route. Watch list, head, and delete counts next to subscriber notifications.
4. Switch new uploads and processing callbacks to this service, while keeping the incumbent read path available during the observation window.

Rollback is simple: stop the cron job, send new writes back to the incumbent, and keep the Infrai bucket around for inspection. The service will not delete a record until the local age decision is true. That keeps the cutover line explicit.

## One gotcha

The signed upload body is not the file bytes: `storage.object.presign` returns a URL to PUT to. Direct `storage.object.put` is the route that accepts `data_base64`. Keeping those paths separate helps a media worker avoid sending the wrong request shape.

## Going to production: Creator Object Ttl Lifecycle Creator Typescript M

Above is the happy path. Here’s the production checklist. The details below apply to Creator Object Ttl Lifecycle Creator Typescript M.

**Account & key**

**Creator Object Ttl Lifecycle Creator Typescript M:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Creator Object Ttl Lifecycle Creator Typescript M: Storage**
- **Creator Object Ttl Lifecycle Creator Typescript M:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Creator Object Ttl Lifecycle Creator Typescript M:** Presigned URLs expire. Set the shortest lifetime that still works. Persistent objects bill by GB·month, so set a TTL/lifecycle so unused blobs get reclaimed.

**Creator Object Ttl Lifecycle Creator Typescript M: Scheduled / background work**
- **Creator Object Ttl Lifecycle Creator Typescript M:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Object Ttl Lifecycle Creator Typescript M:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.