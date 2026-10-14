# BestAgentMedia

A role-aware workspace wireframe for Best Version Media's local publication workflows.

For a developer/LLM handover covering architecture, access rules, data and media storage, issue-canvas behavior, and current limitations, see [DEVELOPMENT.md](./DEVELOPMENT.md). Product intent and persistent project guidance are in [CLAUDE.md](./CLAUDE.md).

Internal database record IDs use sequential numeric primary keys. Keep external/provider identifiers in separate fields and never use them for record IDs or navigation. Preserve existing foreign-key relationships when migrating an entity to this convention.

## React form field conventions

Avoid React's "value prop without an onChange handler" warning:

- If React state controls an editable input, select, or textarea, pair `value` with `onChange` (and `checked` with `onChange` for checkboxes and radios).
- For an uncontrolled field, initialize it with `defaultValue` or `defaultChecked` instead of `value` or `checked`.
- For a field that is intentionally immutable, set `readOnly`; use `disabled` only when it should also be excluded from form submission.
- Review every form control affected by UI changes to ensure it follows one of these patterns.

## Stack

- Next.js App Router and TypeScript for the web server and staff workspace.
- PostgreSQL with Prisma for users, publication assignments, content submissions, businesses, and ads.
- Iron-session encrypted, HTTP-only cookies for login sessions; passwords are hashed with bcrypt.
- Docker Compose is available as an optional way to run PostgreSQL locally; an existing PostgreSQL installation works too.

## Local setup

Requirements: Node.js 20.9 or newer, npm, and PostgreSQL 16 or newer. Docker Desktop is optional.

1. Create a PostgreSQL database named `bestagentmedia` using pgAdmin or `createdb`. You may use an existing PostgreSQL role or create a dedicated local role with permission to create and modify objects in this database.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to your local PostgreSQL role and password, for example `postgresql://postgres:your-password@localhost:5432/bestagentmedia?schema=public`. Set a unique `SESSION_PASSWORD` of at least 32 characters, plus an `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters. URL-encode any special characters in the database username or password.
3. If you prefer Docker-managed PostgreSQL instead, run `docker compose up -d`; its default connection string is already shown in `.env.example`.
4. Install dependencies with `npm install`.
5. Create or update the database schema and deploy the seeded publication cover images with `npm run db:deploy`. This creates `media/publications/` and associates each cover path with its publication.
6. Create the initial administrator and import sample HERE businesses embedded in `prisma/seed.ts` with `npm run db:seed`.
7. Start the app with `npm run dev`, then open `http://localhost:3000`.

The database health endpoint is available at `/api/health`. Prisma Studio can be opened with `npm run db:studio`. The database server must be running before applying migrations, seeding, or using the app.

The `Business` table stores prospect contact details, categories, location, source provider, and HERE place ID. Each business has an internal sequential database ID used for relations and navigation; the HERE place ID is stored separately as the unique `externalId`. Sample HERE prospects are embedded directly in `prisma/seed.ts`; the seed uses each HERE place ID to make repeated runs idempotent. Seeded prospects have no advertiser account linked until an account is explicitly associated with the business.

Publications have sequential numeric internal IDs, unique names, and are associated with five-digit ZIP codes through the separate `ZipCode` table. A publication can be distributed in multiple ZIP codes; the ZIP-code associations are its only location data. The compressed offline seed under `prisma/seed/data` contains 2020 Census TIGERweb ZIP Code Tabulation Area (ZCTA) polygons and 2024 American Community Survey 5-year total population estimates (table B01003), joined on five-digit ZCTA codes. These ZCTAs approximate USPS ZIP code areas and do not exist for every postal ZIP, such as some PO-box-only ZIPs. Refresh the checked-in snapshot with `npm run db:refresh-census-seed` when online; the command is not run during deployment. `npm run db:deploy` migrates and imports the local snapshot offline. The input sources and vintages are recorded in `prisma/seed/data/source.txt`. Publication ZIP-code associations are seeded from `prisma/seed/publications/zips.json`; matching JPEG and PNG covers live beside it and are copied into `media/publications/` during deployment. Rerunning the command is safe. The seed includes 32 publications distributed across the ZIP codes in the checked-in mapping.

Publication maps show the selected ZIP code boundaries over OpenStreetMap roads, places, and other map features, automatically fit to the publication's distribution area. Use the map controls or mouse wheel to zoom and drag to pan. ZIP geometries come from the offline 2020 Census ZCTA snapshot; map tiles are loaded online from OpenStreetMap and displayed with attribution. Administrators can preview, remove, and upload publication covers. Uploads must be PNG or JPEG, no larger than 10 MB, at least 300 × 400 pixels, and decodable as an actual image; accepted images are normalized before storage in `media/publications/`.

Administrators and publishers can open Regions to inspect a ZIP code by clicking its location on the OpenStreetMap map. The app looks up the matching stored Census ZCTA polygon and lists publications visible to that user that are associated with the ZIP code. ZIP polygon boundaries are Census approximations of USPS ZIP code areas.

The public story submission form is available at `/submit-content`. It guides contributors through ZIP/publication selection, story category, story and contact details, and a final review. Submitters may attach up to five JPEG, PNG, or WebP images, each no larger than 10 MB; image uploads are validated and stored outside the public web directory in `media/submissions/`. Submission images are served only to users authorized to view that submission. The `/submissions/[id]` workspace page lets authorized users edit submission details and manage attached images. Apply the `20261012103500_public_content_submissions` and `20261012160000_submission_images` migrations to store story type, ZIP code, optional submitter phone, and submission-image metadata. Each submission is associated with one publication. The `20261012113500_user_phone` and `20261012114000_user_surname` migrations add phone and surname fields to user accounts; the surname migration splits existing full names into first-name and surname fields. Authenticated submitters have their name, surname, email, and phone prefilled. Run `npm run db:deploy` to apply migrations and then `npm run db:seed` to update the administrator from `ADMIN_NAME`, `ADMIN_SURNAME`, and `ADMIN_PHONE`.

Issues are dated releases of a publication. Administrators and publishers can create issues and manage their Draft, Accepted, or Published status. Each issue has one full-width Polotno canvas with a built-in page timeline for arranging its cover, inner pages, and back cover. The building-block controls add editable titles and text or upload JPEG, PNG, and WebP images (up to 10 MB); issue images are stored in `media/issues/` and served only to users authorized for that issue. Article and advertisement libraries are also below the canvas; adding an item places it on the active page. The combined design is saved on the Issue, and linked canvas elements remain associated with their content records for issue tracking. Apply the `20261012133000_issues_articles` and `20261012145000_issue_combined_design` migrations before using Issues or Articles.

Articles contain a title, paragraph-based body, optional captioned images, status (Draft, Accepted, or Published), and one or more publication assignments. Administrators and publishers can create and edit articles; accepted content submissions can be promoted to draft articles with their images copied into article-managed storage. Issue-page designs track which articles and ads are placed in each issue. The Polotno editor runs without an SDK key for local prototyping; its online stock/template integrations and production use may require a Polotno account and license.

The development seed creates two Publisher accounts and two Contributor accounts, assigns the seeded publications evenly between the publishers, and imports five Boca Living sample stories from `prisma/seed/submissions/submissions.json`. It copies the story images checked into `prisma/seed/submissions/` into `media/submissions/` and records the fixture text and image metadata in the database; no story or image content is generated at seed time. Demo accounts use `publisher.one@example.test`, `publisher.two@example.test`, `contributor.one@example.test`, and `contributor.two@example.test`; their password is the local `ADMIN_PASSWORD`. These addresses use the reserved `example.test` domain and are for local development only.

Administrators can create businesses on a dedicated page separate from the Businesses directory, and open a business from the directory to view and edit its stored fields. The detail page displays an OpenStreetMap map marker when latitude and longitude are available.

Administrators can review tasks in Businesses → Import and create new HERE Maps business import tasks on a separate page. Run `npm run db:migrate` to create the task tables before using this feature. Each task searches selected categories within a ZIP-code boundary, skips businesses already present by HERE place ID, and records newly created businesses against the task. The task list refreshes while tasks run and supports stopping or deleting tasks; deleting a task leaves its imported businesses in the directory and clears their task association. HERE searches require a valid `HERE_KEY`. Other source providers are not implemented yet.

### Password recovery email

Set `APP_URL` to the application origin (`http://localhost:3000` locally and your HTTPS origin in production). Configure `MAIL_FROM`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_REQUIRE_TLS` for the sending mailbox. Apply the `20261011110000_password_reset` migration with `npm run db:deploy`. Reset links expire after 30 minutes, are single-use, and are sent only for active accounts. Requests are rate-limited per normalized email address; responses do not reveal whether an account exists. The app sends reset emails but does not read or ingest incoming mailbox messages.

## Roles and data access

- **Administrator:** platform-wide access to publications, submissions, and ads.
- **Publisher:** access to submissions, ads, and publications explicitly assigned to that account.
- **Contributor:** the default when a user's role is `NULL`; access only to content submissions associated with their account.

The only explicit user roles are Administrator and Publisher; users without an assigned role are Contributors. Apply `20261012172000_contributor_default_role` with `npm run db:deploy` to migrate existing contributor and advertiser accounts to the default Contributor state. The Businesses directory and Users list are administrator-only. Role restrictions are applied in server-side data queries and route rendering as well as navigation. Administrators and publishers can update submission and ad review statuses; publisher updates are checked against assigned publications both when loading lists and when saving. This is a starter wireframe; the larger agentic workflows are not implemented yet. Additional accounts should be provisioned through a trusted process; there is no public sign-up route.

## Important environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_PASSWORD` | Secret used to encrypt the session cookie; minimum 32 characters |
| `ADMIN_EMAIL` | Email for the first administrator created by the seed command |
| `ADMIN_PASSWORD` | Password for that administrator; minimum 12 characters |
| `ADMIN_NAME` | First name for the administrator; defaults to Isaac |
| `ADMIN_SURNAME` | Surname for the administrator; defaults to de la Pena |
| `ADMIN_PHONE` | Phone number for the administrator; defaults to +1 650 918 7684 |
| `MAIL_FROM` | Sender address used for application email |
| `MAIL_USERNAME` | IONOS mailbox username |
| `MAIL_PASSWORD` | IONOS mailbox password; set only in local `.env` or the production secret store |
| `APP_URL` | Public app origin used to create password-reset links |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE` | Reserved incoming-mail settings; inbox polling is not implemented |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS` | Outgoing mail server settings; port 587 uses STARTTLS |

SMTP is used for password-reset delivery. The app does not read incoming email. Never commit `.env` or production credentials. Since the mailbox password was shared in chat, rotate it with IONOS before using it in production, then set the new value in `.env` locally or in your host's secret manager.
