# Development Handover

This guide is a technical handover for the current BestAgentMedia workspace. Read it with [README.md](./README.md) for setup and feature details, and [CLAUDE.md](./CLAUDE.md) for product principles and project-specific coding guidance.

## Product and implementation status

BestAgentMedia is a role-aware Next.js application for local publication workflows. The current implementation covers staff workspace flows for publications, ZIP coverage, submissions, businesses, advertiser leads, articles, and issue layouts. Treat it as a functional demo/starter rather than a finished agentic platform: story discovery and ranking, AI-assisted workflows, automated outreach, live email ingestion, and automatic publication/export are not implemented. Keep editorial choices and external actions explicit and reviewable.

## Stack and local development

- Next.js App Router, React, TypeScript, and ESLint.
- PostgreSQL through Prisma; the checked-in schema is `prisma/schema.prisma`.
- Iron-session cookies for authentication and bcrypt password hashing.
- CreativeEditor SDK (`@cesdk/cesdk-js`, pinned to 1.83.0) for the browser-based issue canvas.
- Sharp for validating uploaded image data.
- Docker Compose is optional for local PostgreSQL.

Follow the prerequisites, environment setup, and first-run sequence in [README.md](./README.md). Use `.env.example` to identify required environment variable names. Do not read, copy, log, or commit `.env` values; keep credentials in the local environment or a secret manager.

Useful commands:

```text
npm install
npm run db:deploy
npm run db:seed
npm run dev
npm run lint
npx tsc --noEmit
npx prisma format
npx prisma validate
npx prisma migrate status
npx next build
```

`npm run db:deploy` only applies migrations; all seed data (including ZIP boundaries and publication assets) is loaded by `npm run db:seed`. `npm run db:migrate` is the development migration command. `npm run db:seed` seeds the administrator, publications (from `prisma/seed/publications/`), ZIP data, and agents. No test script is currently declared in `package.json`; use the lint, type-check, Prisma validation, and build commands above for the baseline checks.

The working database had all migrations applied at the last verification, including `20261012145000_issue_combined_design`. A new local database must still run the documented deployment command. Do not assume another developer's database is current.

## Source map

- `src/app/(workspace)/`: authenticated workspace pages for dashboard, publications, submissions, businesses/import, ads, articles, issues, users, and regions.
- `src/app/api/`: JSON endpoints, including public story submission, authorized image delivery, article CRUD, business import tasks, and issue design persistence.
- `src/app/actions/`: server actions for workspace workflows.
- `src/components/`: client forms, maps, and interactive editors.
- `src/lib/`: Prisma access, authentication/session, authorization scopes, image storage/validation, ZIP geometry, business imports, and email.
- `prisma/schema.prisma`: current data model.
- `prisma/migrations/`: ordered SQL schema changes; migrations already applied in an environment are immutable.
- `prisma/seed.ts`, `prisma/publication-seed.ts`, and `prisma/seed/`: seed orchestration and checked-in data/fixtures.
- `media/`: runtime-managed uploaded/deployed media; not a substitute for checked-in seed fixtures.

## Roles, access, and IDs

The `UserRole` values are `CONTRIBUTOR` (everyone; a `NULL` role is treated the same), `EDITOR` (can be assigned as a publication Publisher and create Issues, Advertisements, and Articles), and `ADMIN`. Authorization is enforced in server-side page queries, server actions, and API routes. Reuse the scope helpers in `src/lib/access.ts` (`getSubmissionScope`, `getPublicationScope`, `getIssueScope`, `getArticleScope`, and `getAdvertisementScope`) rather than relying on navigation visibility.

Publishers are restricted to assigned publications. Contributors can access their own submissions and articles allowed by the article scope. The Users list and Businesses directory are administrator-only. Re-check publication ownership when writing, not just when rendering a form.

Important existing schema detail: IDs are not uniform. `Publication`, `ZipCode`, and `Business` use sequential numeric IDs; `User`, `ContentSubmission`, `Issue`, `IssuePage`, `Article`, and image records use string/CUID IDs. The project guidance in `CLAUDE.md` asks that internal IDs use sequential numeric keys. Treat the current mixed schema as legacy/incomplete relative to that direction: do not silently add another mismatch, and do not attempt a broad ID conversion as incidental work. Any conversion needs an explicit migration plan covering every foreign key, API, route, fixture, and client reference.

Publications are linked to five-digit ZIP codes through `ZipCode`; do not add City or State to Publication. City/State are appropriate on Business records. ZIP geometries and population estimates are an offline Census snapshot; the ZCTAs approximate USPS ZIP coverage.

## Seed data and file storage

- Publication mappings and cover fixtures are in `prisma/seed/publications/`; deployment copies covers to `media/publications/`. Runtime code should not depend on the original `store/` folder.
- Census snapshots are in `prisma/seed/data/`; refresh only through `npm run db:refresh-census-seed`.
- New submission uploads are limited to five JPEG, PNG, or WebP files, 10 MB each. They are decoded/validated and stored outside the public web root in `media/submissions/`.
- Article image uploads are stored in `media/articles/`; see `src/lib/article-images.ts` and the authorized route under `src/app/api/articles/[id]/images/[imageId]/`.
- The corresponding image APIs check user access before serving a file. Preserve that protection; do not expose private media with a static public route.
- `media/` contents are runtime data and may be ignored/untracked. Do not delete or replace them during unrelated cleanup.

The seed creates only the administrator account; no demo users, submissions, issues, or businesses are seeded.

## Content workflows

### Submissions

Public contributors use `/submit-content`. The form supports ZIP/publication selection, contact information, story details, and up to five images. Signed-in user information is prefilled. Submission owners can edit their submission and attached images at `/submissions/[id]`; image detail pages are under `/submissions/[id]/images/[imageId]`. Admins and publishers review status; Publisher changes must remain scoped to assigned publications.

An accepted submission can be promoted to a draft Article from the submission workflow. Promotion copies image files into article-managed storage and records the source submission; preserve idempotency around `sourceSubmissionId`.

### Articles and ads

Articles have Draft/Accepted/Published status, a title, paragraph-based body, optional captioned images, and one or more `ArticlePublication` assignments. Article create/update endpoints are under `/api/articles`. Articles may be associated with one or more publications; only content assigned to the issue publication should be insertable into that Issue.

Advertisements belong to a Business and a Publication and have their own review status. The current issue library makes eligible publication ads available to the canvas. Business discovery is implemented for HERE Maps only; other listed providers return Not Implemented. HERE import tasks require `HERE_KEY`, a ZIP with a stored boundary, and an administrator. The importer filters results to the ZIP boundary and skips existing HERE place IDs. Business "Import Images" (`POST /api/businesses/[id]/images/import`) launches a Marketer AgentTask that finds the business via Google Places Text Search (New), downloads up to the remaining 5-image allowance, and stores them as BusinessImage rows (author attribution kept in `originalName`); it requires `GOOGLE_KEY`.

### Issues and the CreativeEditor canvas

An Issue belongs to one Publication and has a publication date and Draft/Accepted/Published status. `IssuePage` rows preserve page identity, order, and type (`COVER`, `INNER`, `BACK_COVER`); `IssuePagePlacement` rows associate canvas element IDs with either an Article or Advertisement.

The editor (`src/components/issue-page-editor.tsx`) intentionally uses **one CreativeEditor SDK (CE.SDK) scene for the entire Issue**, with pages in a `VerticalStack` layout and Pixel design units (816 × 1056 px pages by default). It is not one editor per page. Since CE.SDK 1.73 the web editor starts with an empty UI, so the editor first adds the vendored `DesignEditorConfig` plugin (`src/lib/cesdk-design-editor/`, copied from IMG.LY's `cesdk-web-examples` for 1.83), which supplies the dock, inspector, navigation bar, and panels. It calls `resetEditor()`, so it must be added before any asset sources or actions; re-copy it when upgrading CE.SDK. Without `NEXT_PUBLIC_CESDK_LICENSE`, CE.SDK logs a "For Evaluation Purposes Only" banner (Next.js forwards it to the dev-server terminal) and watermarks exports. The editor's dock includes CE.SDK's default libraries plus **Articles** and **Ads** libraries. These are custom asset sources; applying an item adds a linked image or title block to the current page. Image uploads go through the registered `uploadFile` action to `POST /api/issues/[id]/images` (JPEG/PNG/WebP/SVG, 10 MB maximum). Issue images are stored under `media/issues/<issueId>/` and served through an authenticated, issue-scoped route. Scenes reference them by absolute URL, not embedded data.

Page and content identity live in CE.SDK block metadata (`bestAgentMedia/*` keys in `src/lib/issue-design.ts`): pages carry `issuePageId`/`pageType`, and linked blocks carry `elementId`/`sourceType`/`sourceId`. `src/lib/cesdk-issue-scene.ts` keeps the page rules after every edit:
- New or duplicated pages become inner pages with fresh IDs.
- The cover is moved back to first place and the back cover to last.
- The cover and back cover have the `lifecycle/destroy` scope disabled.

The navigation bar's actions menu (`src/lib/cesdk-issue-files.ts`) exports locally in the browser and downloads the file; nothing is uploaded or sent:
- the current page as PNG, JPEG, WebP, TGA, SVG or MP4;
- the whole issue as one multi-page PDF;
- audio blocks as WAV/M4A (only present in imported scenes);
- the scene as `.imgly`, or an archive `.imgly` with embedded assets.

Importing a scene or archive (`.imgly`, `.scene`, `.zip`) replaces the layout after confirmation. `adoptImportedScene` maps the imported pages onto the issue's page IDs by position (first page = cover, last = back cover) and adds blank pages until there are at least three. It strips links to articles or ads outside the issue's libraries. Archive-embedded images are uploaded to the issue media folder and relocated. Other embedded assets, such as fonts or video, are reported as not stored. If the import fails, the previous scene is restored. Issue image uploads accept SVG as well as JPEG, PNG and WebP. The image route serves files with a sandboxing `Content-Security-Policy`.

`Issue.designJson` holds one of two formats (see `src/lib/issue-design.ts`):
- **CE.SDK document** (`format: "cesdk"`), written by the editor. It contains the opaque `engine.scene.saveToString()` result plus a `pages` manifest of page IDs and linked elements derived from block metadata. The server validates the manifest without decoding the scene.
- **Layout specification** with simple `text`/`image` elements. AI layout generation (`POST /api/issues/[id]/generate-layout`) produces this format as a Designer task result. It is written to the issue only when someone chooses **Apply to issue** on the task page (the redeploy endpoint). Designs saved before the CE.SDK migration (Polotno JSON) also use it. The editor converts a layout specification into a CE.SDK scene when the issue is opened, and the next save stores it as a CE.SDK document; no data migration is required.

The migration `20261012145000_issue_combined_design` removed `IssuePage.designJson`. Do not restore per-page persistence unless the data model and migration strategy are intentionally redesigned.

`PATCH /api/issues/[id]/design` is the aggregate persistence endpoint and only accepts the CE.SDK document format. It validates:
- authentication, role, and issue scope;
- JSON size (5 MB maximum) and shape;
- page IDs and cover/back-cover placement;
- that linked articles and ads are available within the Issue's publication.

It reconciles IssuePage rows in canvas order and rebuilds IssuePagePlacement records transactionally. New pages use their metadata IDs as database IDs. `GET /api/issues/[id]/images/[filename]` serves issue assets after checking issue access. Preserve the invariant that the cover remains first, the back cover remains last, and at least one inner page remains.

CE.SDK runs without a license key in evaluation mode, which watermarks exports. `NEXT_PUBLIC_CESDK_LICENSE` is optional; do not add a hard license gate that prevents the local prototype from loading. The editor currently uses CE.SDK's default asset location, the IMG.LY CDN, for engine WASM, fonts, UI assets, and default libraries (typefaces, shapes, stickers, filters). IMG.LY documents that location as intended for development only. For self-hosting, download the `imgly-assets.zip` archive that matches the installed SDK version and serve it from the app, for example `public/cesdk/<version>/`. Then pass that location as `baseURL` to `CreativeEditorSDK.create` and as `baseURL` to each asset-source plugin.

## Tasks (long-running operations)

Every operation that is not resolved instantly is a **Task**: agent jobs (Designer layouts, Creative image enhancement and ad generation, Copywriter reviews, Assistant clarification drafts, Marketer pitches, automatic invites), business imports, and business onboarding (reachout). Follow this architecture for any new long-running feature:

- **Never block the UI.** The launch endpoint validates the request, records the task, runs the work in the background with `after()` from `next/server`, and responds immediately (HTTP 202) with the registry task `{ task: { id, name } }` (or `{ tasks: [...] }`). Do not await model calls in the request, and do not show spinner modals or result dialogs. A dialog that only collects options before launch is fine.
- **Announce, don't wait.** Client launchers call `announceTaskStarted()` from `src/lib/task-events.ts`, or use the `useTaskLauncher()` hook in `src/components/use-task-launcher.ts`. `TaskNotifier` (mounted in the workspace layout) shows a "started" toast. It polls `GET /api/tasks/notifications` and shows a notification at the top of the screen when the user's task succeeds, fails, or stops. Clicking it opens `/tasks/[id]`. Each completion is announced once, because the endpoint atomically sets `Task.notifiedAt`.
- **One list.** `/tasks` (the **Tasks** link at the bottom of the sidebar) lists tasks sortable by name, date, agent type (may be None), and status. Statuses are labelled Queued, Ongoing, Success, Error, and Stopped (`src/lib/task-status.ts`). Administrators see all tasks; other users see the tasks they launched (`getTaskScope` in `src/lib/tasks.ts`).
- **Show the agent.** Every task creation screen that involves an agent or sub-agent renders `<AgentBadge agentSlug="…" />` (`src/components/agent-badge.tsx`) with the agent's picture and name. It links to `/tasks?agent=<id>` (plus `&subAgent=<id>` for a sub-agent), which lists only that agent's tasks. Identities come from `GET /api/agents/directory`; picture GET routes are readable by any signed-in user.
- **One page per template.** `/tasks/[id]` chooses a template with `getTaskTemplate()`:
  - `layout`: page previews plus **Apply to issue**.
  - `creative`: original versus result, with Discard / Overwrite / Keep / Iterate.
  - `email-draft`: the draft plus **Send email** (administrators).
  - `review`: editorial feedback.
  - `business-import` and `reachout`: results of those jobs.
  - `generic`: everything else.

  Agent tasks also show their step log. Results stay drafts or proposals until a person acts. For example, layout generation no longer writes `Issue.designJson`; the layout is applied only from the task page. Stop and delete are generic: `PATCH`/`DELETE /api/tasks/[id]`.

**Data model.** `Task` (numeric ID, used for routes) is a registry over the backing tables `AgentTask`, `BusinessImportTask`, and `ReachoutTask`. Postgres triggers create and update the `Task` row whenever a backing row is inserted or updated. Those triggers are defined in migration `20261014150000_task_registry`, and they cover writes from schedulers and the IMAP poller as well as request handlers. Deleting the backing row cascades to the registry row. Application code only reads `Task` and sets `notifiedAt`; change status on the backing record.

**Adding a task type.**
- For an agent job, call `launchAgentTask({ agentId, label, triggeredById, steps, work })` from `src/lib/agent-task-runner.ts`. `work` receives `log()` for live progress and returns the result JSON; a thrown error marks the task Error. A task stopped by a user keeps its Stopped status.
- Then add a template branch in `getTaskTemplate()` and a view on `/tasks/[id]` if the result needs one.
- A job that needs its own table also needs a new `TaskSource` value, a foreign-key column on `Task`, and a sync trigger in a new migration.

Background work runs inside the Next.js server process. A task still running when the server restarts stays Ongoing until someone stops it.

## Migrations and validation

- Add schema changes in `prisma/schema.prisma` and create a new migration; do not edit an applied migration to change a deployed schema.
- After schema edits, run `npx prisma format`, `npx prisma validate`, and regenerate Prisma Client (`npx prisma generate`) when the local database engine is not locked by another process.
- Validate changes with `npm run lint`, `npx tsc --noEmit`, and `npx next build`.
- On Windows, Prisma Client generation can intermittently fail with `EPERM` when `query_engine-windows.dll.node` is in use. Retry after the process holding the engine exits; avoid deleting dependencies or force-stopping unidentified processes.
- No automated test runner is currently configured. Add focused tests when introducing behavior with meaningful validation or business rules.

## Email and IMAP configuration

### DUMMY_EMAIL override

**If `DUMMY_EMAIL` is set to a non-empty value in `.env`, ALL outreach emails sent through sub agents MUST be redirected to that address instead of the real recipient email stored in the database.** This applies everywhere `sendSubAgentEmail` is called — check `process.env.DUMMY_EMAIL?.trim()` before constructing the `to` field. The real recipient email is still recorded in `EmailThread.toEmail` and `EmailMessage.toEmail` for auditing, but the actual SMTP delivery must go to `DUMMY_EMAIL` so that no real contacts are emailed during development or demos.

Do not apply the DUMMY_EMAIL override to password reset emails; those are user-initiated account operations, not agent outreach.

### Sub agent email configuration

Each `SubAgent` record stores its own SMTP and IMAP credentials in the `config` JsonB field. The field is typed as `SubAgentConfig` in `src/lib/sub-agent-email.ts`. Passwords are stored as plaintext in the database for demo purposes — never log these fields, never expose them in API responses, and use app passwords (not primary account passwords) for any real accounts.

SMTP is used by `sendSubAgentEmail` to send outbound emails. IMAP is used by `pollSubAgentInbox` (triggered manually via `POST /api/agents/[id]/sub-agents/[subId]/check-inbox`) to fetch replies. Replies are matched to outbound messages using the `In-Reply-To` email header, which must contain the `Message-ID` that was embedded in the original outbound email. Message-IDs are stored in `EmailMessage.messageId` without angle brackets; the SMTP header includes them with angle brackets (`<{id}>`).

### Conversation tracking

Email threads are stored in `EmailThread` (one per conversation) and `EmailMessage` (one per email, direction `OUTBOUND` or `INBOUND`). Both link back to the `SubAgent` and optionally to the `AgentTask` that originated the outreach. The web UI for auditing conversations is at `/agents/[id]/sub-agents/[subId]`. Threads are viewable but not actionable from that page — actual sending is triggered from the task list on `/agents/[id]`.

## Known limitations and handoff notes

- This is a starter/demo. Do not claim the broader agent workflows listed in `CLAUDE.md` are implemented.
- Password reset sends outgoing mail through SMTP but does not poll or ingest incoming email. IMAP variables are reserved for the global config; sub agents use their own per-record IMAP credentials.
- HERE is the only implemented business search provider.
- Issue layout JSON is editable and linked to Article/Advertisement records, but a complete print-production/export workflow is not implemented.
- The main editorial submission experience and role-based workspace are implemented; new account registration is not public.
- The repository may start with unrelated dirty/untracked files. Inspect `git status` before changing or cleaning anything and preserve work that is not part of the current task.
