# Development Handover

This guide is a technical handover for the current BestAgentMedia workspace. Read it with [README.md](./README.md) for setup and feature details, and [CLAUDE.md](./CLAUDE.md) for product principles and project-specific coding guidance.

## Product and implementation status

BestAgentMedia is a role-aware Next.js application for local publication workflows. The current implementation covers staff workspace flows for publications, ZIP coverage, submissions, businesses, advertiser leads, articles, and issue layouts. Treat it as a functional demo/starter rather than a finished agentic platform: story discovery and ranking, AI-assisted workflows, automated outreach, live email ingestion, and automatic publication/export are not implemented. Keep editorial choices and external actions explicit and reviewable.

## Stack and local development

- Next.js App Router, React, TypeScript, and ESLint.
- PostgreSQL through Prisma; the checked-in schema is `prisma/schema.prisma`.
- Iron-session cookies for authentication and bcrypt password hashing.
- Polotno for the browser-based issue canvas.
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

`npm run db:deploy` deploys migrations and publication assets. `npm run db:migrate` is the development migration command. `npm run db:seed` seeds the administrator, demo accounts, publications, businesses, ZIP data, and static submission fixtures. No test script is currently declared in `package.json`; use the lint, type-check, Prisma validation, and build commands above for the baseline checks.

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

The explicit `UserRole` values are `ADMIN` and `PUBLISHER`. Contributors are ordinary users whose `role` is `NULL`; there is no Contributor enum value. Authorization is enforced in server-side page queries, server actions, and API routes. Reuse the scope helpers in `src/lib/access.ts` (`getSubmissionScope`, `getPublicationScope`, `getIssueScope`, `getArticleScope`, and `getAdvertisementScope`) rather than relying on navigation visibility.

Publishers are restricted to assigned publications. Contributors can access their own submissions and articles allowed by the article scope. The Users list and Businesses directory are administrator-only. Re-check publication ownership when writing, not just when rendering a form.

Important existing schema detail: IDs are not uniform. `Publication`, `ZipCode`, and `Business` use sequential numeric IDs; `User`, `ContentSubmission`, `Issue`, `IssuePage`, `Article`, and image records use string/CUID IDs. The project guidance in `CLAUDE.md` asks that internal IDs use sequential numeric keys. Treat the current mixed schema as legacy/incomplete relative to that direction: do not silently add another mismatch, and do not attempt a broad ID conversion as incidental work. Any conversion needs an explicit migration plan covering every foreign key, API, route, fixture, and client reference.

Publications are linked to five-digit ZIP codes through `ZipCode`; do not add City or State to Publication. City/State are appropriate on Business records. ZIP geometries and population estimates are an offline Census snapshot; the ZCTAs approximate USPS ZIP coverage.

## Seed data and file storage

- Publication mappings and cover fixtures are in `prisma/seed/publications/`; deployment copies covers to `media/publications/`. Runtime code should not depend on the original `store/` folder.
- Census snapshots are in `prisma/seed/data/`; refresh only through `npm run db:refresh-census-seed`.
- Submission text and image fixtures are checked in under `prisma/seed/submissions/`. The seed copies fixture images into `media/submissions/`; it does not generate submission text/images at runtime.
- New submission uploads are limited to five JPEG, PNG, or WebP files, 10 MB each. They are decoded/validated and stored outside the public web root in `media/submissions/`.
- Article image uploads are stored in `media/articles/`; see `src/lib/article-images.ts` and the authorized route under `src/app/api/articles/[id]/images/[imageId]/`.
- The corresponding image APIs check user access before serving a file. Preserve that protection; do not expose private media with a static public route.
- `media/` contents are runtime data and may be ignored/untracked. Do not delete or replace them during unrelated cleanup.

The seed includes demo Publisher/Contributor accounts and five Boca Living submission fixtures. Demo account addresses and seed behavior are documented in the README. The seed uses the local administrator password for demo accounts, so only use it with local/demo credentials.

## Content workflows

### Submissions

Public contributors use `/submit-content`. The form supports ZIP/publication selection, contact information, story details, and up to five images. Signed-in user information is prefilled. Submission owners can edit their submission and attached images at `/submissions/[id]`; image detail pages are under `/submissions/[id]/images/[imageId]`. Admins and publishers review status; Publisher changes must remain scoped to assigned publications.

An accepted submission can be promoted to a draft Article from the submission workflow. Promotion copies image files into article-managed storage and records the source submission; preserve idempotency around `sourceSubmissionId`.

### Articles and ads

Articles have Draft/Accepted/Published status, a title, paragraph-based body, optional captioned images, and one or more `ArticlePublication` assignments. Article create/update endpoints are under `/api/articles`. Articles may be associated with one or more publications; only content assigned to the issue publication should be insertable into that Issue.

Advertisements belong to a Business and a Publication and have their own review status. The current issue library makes eligible publication ads available to the canvas. Business discovery is implemented for HERE Maps only; other listed providers return Not Implemented. HERE import tasks require `HERE_KEY`, a ZIP with a stored boundary, and an administrator. The importer filters results to the ZIP boundary and skips existing HERE place IDs.

### Issues and the Polotno canvas

An Issue belongs to one Publication and has a publication date and Draft/Accepted/Published status. `IssuePage` rows preserve page identity, order, and type (`COVER`, `INNER`, `BACK_COVER`); `IssuePagePlacement` rows associate canvas element IDs with either an Article or Advertisement.

The current editor intentionally uses **one Polotno store/canvas for the entire Issue**, with Polotno's `PagesTimeline` managing pages. It is not one editor per page. The full-width canvas is above the editor controls and article/ad libraries. The page strip scrolls horizontally; a vertical mouse-wheel gesture over the page strip is translated into horizontal scrolling. Building-block controls add editable title and body text elements or upload JPEG/PNG/WebP images (10 MB maximum) to the active page. Issue images are stored under `media/issues/<issueId>/` and served through an authenticated, issue-scoped route; they are not embedded as base64 in the design JSON. Selecting article/ad library content adds a linked image or title element to the active page.

The full Polotno document is stored as JSON in `Issue.designJson`. The migration `20261012145000_issue_combined_design` transferred legacy per-page designs into this combined document and removed `IssuePage.designJson`. Do not restore per-page persistence unless the data model and migration strategy are intentionally redesigned.

`PATCH /api/issues/[id]/design` is the aggregate persistence endpoint. It validates authentication/role, issue scope, JSON size and shape, page IDs, cover/back-cover placement, and linked article/ad availability within the Issue's publication. It reconciles IssuePage rows in canvas order and rebuilds IssuePagePlacement records transactionally. New Polotno pages use their canvas IDs as database IDs. `POST /api/issues/[id]/images` accepts issue-scoped image uploads; `GET /api/issues/[id]/images/[filename]` serves those assets after checking issue access. Preserve the invariant that the cover remains first, the back cover remains last, and at least one inner page remains.

The Polotno prototype works with an empty SDK key for local editing. Online stock/template integrations and production licensing can require a Polotno account/license. Do not add a hard API-key gate that prevents the local prototype from loading.

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
