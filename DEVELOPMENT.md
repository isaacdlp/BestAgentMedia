# Development Handover

This guide is a technical handover for the current BestAgentMedia workspace. Read it with [README.md](./README.md) for setup and feature details, and [CLAUDE.md](./CLAUDE.md) for product principles and project-specific coding guidance.

## Product and implementation status

BestAgentMedia is a role-aware Next.js application for local publication workflows. The current implementation covers staff workspace flows for publications, ZIP coverage, submissions, businesses, advertiser leads, articles, and issue layouts. Treat it as a functional demo/starter rather than a finished agentic platform: story discovery and ranking, AI-assisted workflows, automated outreach, live email ingestion, and automatic publication/export are not implemented. Agents may act independently, including sending emails, without a human approval step.

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

Articles have Draft/Accepted/Published status, a title, paragraph-based body, optional captioned images, and one or more `ArticleIssue` assignments (ads use `AdvertisementIssue`). Article create/update endpoints are under `/api/articles`. Articles and ads connect to specific Issues, not Publications; only content assigned to an Issue is insertable into it. Only submissions connect to a generic Publication.

The article body is edited with TipTap (`src/components/rich-text-editor.tsx`), using only MIT-licensed open-source packages (`@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extensions`); no TipTap Pro/Cloud license or extensions are used. The body is stored as Markdown, so plain-text bodies with blank-line paragraphs load and save unchanged. Emails and agent prompts still treat it as plain text, so any formatting shows as Markdown syntax there. The issue layout editor keeps the formatting: `src/lib/article-rich-text.ts` parses the Markdown (with `marked`, already used by `@tiptap/markdown`) into styled paragraphs, and template body columns get bold, italic, strikethrough, larger bold subheadings (H2/H3) and native CE.SDK bulleted/numbered lists with nesting. Links keep their text only, and an H1 is dropped because it repeats the title. **Blockquotes are not styled in the layout:** the Quote button marks the line to pull into a template's pull-quote (highlight) slot. The first blockquote fills that slot, and its text also stays in the body as an ordinary paragraph.

Advertisements belong to a Business and a Publication and have their own review status. The current issue library makes eligible publication ads available to the canvas. Business discovery is implemented for HERE Maps only; other listed providers return Not Implemented. HERE import tasks require `HERE_KEY`, a ZIP with a stored boundary, and an administrator. The importer filters results to the ZIP boundary and skips existing HERE place IDs. Business "Import Images" (`POST /api/businesses/[id]/images/import`) launches a Marketer AgentTask that finds the business via Google Places Text Search (New), downloads up to the remaining 5-image allowance, and stores them as BusinessImage rows (author attribution kept in `originalName`); it requires `GOOGLE_KEY`.

### Article Enhance and Promote

The article page header has **Enhance**, plus **Promote** while the article has no paid promotion style or **Submit for Review** once it has one (the earlier Review button was removed; `POST /api/articles/[id]/review` still exists). An unpaid article needs no advertiser review: `launchPromotionReview()` rejects it with 409.

- **Enhance** (administrators and editors, enabled Copywriter) opens the shared `AgentPromptButton` dialog with a target length in pages (0.25 to 6, quarter-page steps, default 1) and optional instructions, then calls `POST /api/articles/[id]/enhance` with `{ instructions, targetPages }`. The Copywriter drafts a print-ready version as rich-text Markdown (H2/H3 subheadings, bold/italic, lists, block quotes, existing links only; no raw HTML, because the body is stored as Markdown) at about `targetPages × ARTICLE_WORDS_PER_PAGE` words (550, an editorial estimate in `src/lib/article-enhance.ts`). The task result has `contentType: "article-revision"` and uses the same side-by-side revision template as submissions; the article changes only when someone accepts it (`POST /api/articles/[id]/enhance/[taskId]` with `accept` or `discard`; `force: true` if the article was edited since).
- **Promote** (administrators, enabled Marketer) is shown only while the article has no paid promotion style (Style is None) and is clickable only when it has a business; it is also disabled when the business has no email or a promotion conversation for the article is already open. Its dialog picks an upcoming issue (issues the article is slated for, plus issues of publications serving the business's ZIP code) and optional instructions, then calls `POST /api/articles/[id]/promote`. This runs the same `launchPromotionSales()` flow as the Promote page (below) for the article's business, with `PromotionSale.articleId` set. The Marketer gets the article's title and body (up to 6,000 characters) and leads with signing it up as a paid sponsored feature. When the business buys a sponsored article, the first one is applied to this article (style, `styleName`, `costCents`, issue assignment, `PromotionSaleItem.articleId`) instead of creating a new draft; other purchased placements get drafts as usual. The ZIP check is skipped when the article is already slated for the chosen issue. Migration: `20261021090000_promotion_sale_article`.

### Advertiser review and paid promotion (Marketer)

**Submit for Review** on `/ads/[id]` opens a dialog for optional custom instructions (stored as `PromotionDeal.instructions`, max 2,000 characters, and added to the Marketer's context for every message), then calls `POST /api/ads/[id]/submit-review` or `POST /api/articles/[id]/submit-review` with `{ instructions }`. On articles the button replaces **Promote** once the article has a paid promotion style (see above), and the endpoint rejects unpaid articles. Both use `launchPromotionReview()` in `src/lib/promotion-deals.ts`, and both need an administrator or editor, the matching content scope, `CLAUDE_KEY`, an enabled Marketer, and a business email (an article must be linked to a business). Only one conversation can be open per ad or article.

The flow:
1. **Launch.** The endpoint creates a RUNNING `AgentTask` with `result.contentType = "promotion"` (task template `promotion`) and a `PromotionDeal` row with a numeric ID. It picks a Marketer sub agent that has SMTP configured; a business that already has a deal keeps its sub agent. It also picks the soonest upcoming assigned issue.
2. **First email.** `sendInitialPromotionEmail()` runs in `after()`. `generateMarketerMessage()` (`src/lib/marketer-reply.ts`) writes the email, and the exact content preview replaces the `{{CONTENT_PREVIEW}}` placeholder. The email attaches the ad creative or up to three article images. A draft ad moves to In review.
3. **Replies.** The IMAP poller calls `handlePromotionInboundMessage()`. Claude replies through a strict `send_email` tool that also classifies the message:
   - content approved: the deal records it, an ad gets an `AdReview`, and a draft or in-review ad becomes Approved;
   - changes requested: they are appended to `requestedChanges`, and an ad gets an `AdReview` (an approved ad goes back to In review);
   - interested, signed up (must name a configured package key), or declined.

   A sign-up completes the task (Success) and stamps the article with the package as its paid promotion (`promotionPackageId`, `styleName`, `costCents` = package price). An article that is already paid (any of those set, e.g. from a Promote purchase or priced by staff) is treated like an ad: the Marketer uses the `paid_article` prompt, sells nothing, and approval completes the task. A decline or opt-out stops it. A declined advertiser who writes again reopens it. Replies continue after a sign-up. A task stopped by staff is not answered. `handleGenericInboundMessage` skips promotion threads.
4. **Follow-up.** `checkPromotionFollowUps()` runs after each inbox poll. It sends one follow-up after `promotion.followUpDays` days without a reply.

**Ads are not sold.** An ad is always created after its price and placement were agreed, so for ads the Marketer's goal is approval of the creative and a happy repeat customer. For ads (`kind: "ad"` in `generateMarketerMessage()`):
- the Marketer gets no rate card, quotes no prices and never mentions packages (`packagesOf()` returns none);
- the first email says the ad is ready for approval and links the review page;
- the task ends as **Success** when the ad is approved (page click or an email reply the Marketer classifies as approval), not on a sign-up;
- changes requested after an approval reopen the task to Ongoing;
- the Marketer answers every reply and review by email;
- it nudges unanswered emails again after `promotion.followUpDays`, up to 3 unanswered emails in a row (articles keep a single follow-up).

When staff set a new creative on the ad (**Set as Creative**), `scheduleAdArtworkNotification()` makes the Marketer email the revised artwork on the same thread (mode `revised`, listing the changes the advertiser asked for, artwork attached, review link included). `PromotionDeal.sentCreativeFileName` makes each artwork go out once. The deal returns to "awaiting review", an Approved ad goes back to In review, and the Marketer keeps the dialog going until the new version is approved. Migration: `20261015100000_deal_sent_creative`.

**Ad review page and Reviews tab.** An ad's deal gets a random `reviewToken`; the token is a credential, not a record ID. The first email and the Marketer's context include the public link `APP_URL/review/<token>`. Anyone with the link can see the page without logging in. It shows the ad artwork (served by `GET /api/review/[token]/creative`), headline, copy, size and issue, and it never shows contact details. The form posts to `POST /api/review/[token]` (`submitAdReviewFromPage()`): Approve, or Request changes with a required comment, plus an optional name. Each review:
- creates an `AdReview` row (numeric ID; `source` `REVIEW_PAGE` or `EMAIL`, `decision`, comments, and the creative file shown at the time);
- updates the deal's `contentStatus`, `requestedChanges` and `lastInboundAt`, so no "no reply" follow-up is sent;
- logs a task step;
- triggers a Marketer acknowledgement email on the thread (mode `review_received`).

An approval moves a Draft or In review ad to Approved, and a change request moves an Approved ad back to In review. Email verdicts on ads are stored as `AdReview` rows too (`recordAdReview()` in `src/lib/ad-reviews.ts`). A link stops accepting reviews when its task fails or staff stop it, when a newer deal exists for the ad, or after 30 reviews. `/ads/[id]?tab=reviews` lists all reviews in order, oldest first. The ad page no longer has the "Advertiser review & promotion" panel; the conversation status is on the task page. `POST /api/creative/generate-ad` passes the reviews to the Creative (up to the latest 10 in the prompt) unless `includeReviews: false`; the Generate dialog has a checkbox for this. Migration: `20261015090000_ad_reviews`.

Prices come from the publication's rate card, `PromotionPackage` (numeric ID, kind `AD` or `ARTICLE`, name, description, `priceCents`, position). Administrators edit it under **Promotion rates** on `/publications/[id]` (`updatePublicationRates`); editors see it read-only. A deal records its `publicationId`: the chosen issue's publication, or else the publication covering the business ZIP. Packages are read live for every message and offered to Claude by package ID. A sign-up stores `packageId` plus the agreed `packageName` and `priceCents`, so later rate changes don't alter agreed deals. Without rates, the Marketer quotes no prices and cannot record a sign-up. The Marketer also tells the advertiser the Census population of the publication's ZIP codes, labelled as population, never as circulation.

An ad also has a style: `Advertisement.promotionPackageId` points to one of the ad rates of its issues' publications. The create and edit forms show a required **Style** picker once an issue is selected; it displays the cost (price per issue × the selected issues of that publication). The server rejects a style that is not an ad rate of those publications, and a style is required whenever they have ad rates. The Marketer is told the ad's style and recommends it first. The ad stores `styleName` and `costCents`; the cost starts at that list price and is editable (for example a client discount), and an entered cost replaces the calculated one. Advertisements no longer have a call-to-action URL. Migrations: `20261014210000_ad_promotion_package`, `20261014220000_ad_style_cost`, `20261014230000_remove_ad_cta`.

The seed gives each publication without rates a demo rate card from `prisma/seed/publications/pricing.json`: base price × audience factor ((population / 100k)^0.35, clamped 0.6–2.0) × an affluence index assumed for each market. These are demo figures, not BVM pricing. Model and follow-up timing live in the Marketer settings under `promotion` (`src/lib/promotion-packages.ts`). No payment integration exists: a sign-up is an emailed confirmation, and staff send the agreement and invoice. Migration: `20261014200000_promotion_deals`.

### Promote: selling an issue to businesses (Marketer)

**Promote** sits right of **Onboard** on `/businesses`. It links to `/businesses/promote/new`; on `/businesses/[id]` it links there with `?business=<id>`, which limits the issue list to publications serving that business's ZIP code and preselects the business. Promote is administrator-only and needs an enabled Marketer, `CLAUDE_KEY`, and a Marketer sub agent with SMTP.

1. **Pick the issue first.** Only upcoming, unpublished issues are offered (`promotableIssueWhere()`), and the publication must have promotion rates. The business list comes from `GET /api/businesses?issueId=…`. It returns only businesses whose ZIP code is served by that issue's publication, plus a `saleStatus`:
   - `eligible`;
   - `active`: a conversation for this issue is open;
   - `purchased`: the business already bought in this issue, and that conversation continues;
   - `opted_out`: the business opted out of any sale or review conversation.

   Search covers the whole dataset, including ZIP codes. Optional custom instructions (up to 2,000 characters) go into every message.
2. **Launch.** `POST /api/promotion-sales` `{ issueId, businessIds, instructions }` (`launchPromotionSales()` in `src/lib/promotion-sales.ts`) creates one RUNNING `AgentTask` (template `sale`, `result.contentType = "sale"`) and one `PromotionSale` per eligible business. It skips ineligible businesses and returns them with a reason. It responds 202. First emails go out in `after()`.
3. **Dialog.** Every email is written by Claude through `generateSaleMessage()` (`src/lib/marketer-sale.ts`); nothing is canned. A strict `send_email` tool returns the email plus the offer it states: `items` (package key + issue key, plus working title and brief on a purchase), `discount_percent`, `decision` (`none`/`interested`/`purchased`/`declined`), and `opted_out`. The Marketer gets:
   - the publication's full rate card (ads and sponsored articles);
   - up to six upcoming issues of the publication, so it can sell multi-issue bundles;
   - the business's details and the Census population (never presented as circulation);
   - earlier purchases in the conversation and the last offer made.
4. **Pricing rules (server-enforced).** `priceSaleMessage()` validates every draft before it is sent: known packages and issues, discount ≤ `promotion.maxDiscountPercent` (default 15, max 50), and no discount on a single placement unless the campaign has custom instructions (the prompt only allows it when they say so). A draft that breaks a rule is sent back to the model once with the problem; if it still fails, nothing is sent and the task log records why. Prices are list × (100 − discount) / 100, rounded to the cent.
5. **Purchase.** On `purchased`, `createPurchasedDrafts()` creates one `PromotionSaleItem` per placement not already recorded. The model always lists the complete order, so a repeated confirmation creates nothing twice. Each item records the package, issue, list price, discount and agreed price, and gets a draft:
   - **Ad:** Draft `Advertisement` with style = package, `costCents` = agreed price, the purchased issue, the model's headline and brief, and the business images copied over.
   - **Article:** Draft `Article` with style = package, `costCents` = agreed price, linked to the business and issue, its body the sales brief (marked for replacement), and up to five business images.

   The sale becomes PURCHASED and the task Success. From there the existing ad/article flow (Generate, Submit for Review) applies. No payment is taken.
6. **Replies and follow-ups.** The IMAP poller calls `handlePromotionSaleInboundMessage()`. `isPromotionThread()` also covers sale threads, so the generic/pitch handlers skip them.
   - A decline or opt-out stops the task.
   - A declined business that comes back interested reopens it.
   - A task stopped by staff is not answered.
   - Replies continue after a purchase; further purchases add items.

   `checkPromotionSaleFollowUps()` sends one follow-up after `promotion.followUpDays` days without any reply.

The task page shows the status, the current offer, the purchased placements with list and agreed prices, links to the drafts, and the conversation. Migration: `20261016090000_promotion_sales` (`PromotionSale`, `PromotionSaleItem`, enum `PromotionSaleStatus`; all numeric IDs).

### Issues and the CreativeEditor canvas

An Issue belongs to one Publication and has a publication date and Draft/Accepted/Published status. `IssuePage` rows preserve page identity, order, and type (`COVER`, `INNER`, `BACK_COVER`); `IssuePagePlacement` rows associate canvas element IDs with either an Article or Advertisement.

The editor (`src/components/issue-page-editor.tsx`) intentionally uses **one CreativeEditor SDK (CE.SDK) scene for the entire Issue**, with pages in a `VerticalStack` layout and Pixel design units (816 × 1056 px pages by default). It is not one editor per page. Since CE.SDK 1.73 the web editor starts with an empty UI, so the editor first adds the vendored `DesignEditorConfig` plugin (`src/lib/cesdk-design-editor/`, copied from IMG.LY's `cesdk-web-examples` for 1.83), which supplies the dock, inspector, navigation bar, and panels. It calls `resetEditor()`, so it must be added before any asset sources or actions; re-copy it when upgrading CE.SDK. Without `NEXT_PUBLIC_CESDK_LICENSE`, CE.SDK logs a "For Evaluation Purposes Only" banner (Next.js forwards it to the dev-server terminal) and watermarks exports. The editor's dock includes CE.SDK's default libraries plus **Articles**, **Images** and **Ads** libraries. These are custom asset sources; applying an item adds a linked image or title block to the current page. **Images** lists every article picture as its own item (`bestAgentMedia.articleImages`), so one photo can be placed without the rest of its article: it goes into a selected picture placeholder, or onto the current page sized to the photo, and stays linked to its article. Image uploads go through the registered `uploadFile` action to `POST /api/issues/[id]/images` (JPEG/PNG/WebP/SVG, 10 MB maximum). Issue images are stored under `media/issues/<issueId>/` and served through an authenticated, issue-scoped route. Scenes reference them by absolute URL, not embedded data.

Page and content identity live in CE.SDK block metadata (`bestAgentMedia/*` keys in `src/lib/issue-design.ts`): pages carry `issuePageId`/`pageType`, and linked blocks carry `elementId`/`sourceType`/`sourceId`. `src/lib/cesdk-issue-scene.ts` keeps the page rules after every edit:
- New or duplicated pages become inner pages with fresh IDs.
- The cover is moved back to first place and the back cover to last.
- The cover and back cover have the `lifecycle/destroy` scope disabled.

**Page templates.** Each page can use a different template, chosen from the editor's **Templates** dock library. The Templates dock button opens a custom panel (`bestAgentMedia.templates.panel`) with **Cover**, **Inner** and **Back** tabs, each a full multi-row grid; it opens on the current page's tab. The stock asset-library panel previews multi-entry sections in a single row, so it is not used here. The template source reports each template's `pageTypes` as asset groups, and one library entry per page type filters on its group (`includeGroups`). A template allowed on several page types appears in each matching tab. The panel closes itself when another dock button opens the stock library panel.
- **Definitions.** Templates are plain data in `src/lib/issue-templates.ts`: **Feature photo**, **Feature spread** (headline between rules, introduction, two columns, three photos), **Photo story with quote** (wide photo, two columns, pull-quote panel), **Two stories** (continued text plus two side-by-side stories), **Text columns** (wide headline over two full-height columns, for text-only stories and continued articles), and five ad pages: **Full-page ad** (one full-bleed ad slot), **Half-page ad** (wide headline and two columns over a half-page ad), **Quarter-page ad** (wide headline, a full-height first column and a shorter second column above a quarter-page ad in the bottom-right corner), **Two half-page ads** and **Four quarter-page ads** (ad slots `ad`, `ad-2`, …) for inner pages, and the cover-only **Journer cover** (masthead between rules, issue number and date, a framed lead photo with its cover line as story 1, and three teasers as stories 2–4, each a headline plus an introduction limited to 100 characters), and the back-cover-only **Journer back cover** (headline and introduction over a rule, a framed photo slot that also takes an ad, a decorative non-scannable barcode, and Contact Us / Get Connected / Our Location label columns with placeholder details, since publications store no contact information). Each template lists named slots (`title`, `subtitle`, `body`, `quote`, `image`, `ad`, `caption`, `pageNumber`, `label`, `decoration` shapes and rules) with frames on the 816 × 1056 reference page, plus the page types it allows. A slot's optional `story` groups content when a page holds several articles (default 1; story 0 is text continued from a previous page). Frames and font sizes scale to the actual page size. Library thumbnails are generated from the slots.
- **Applying.** `src/lib/cesdk-issue-templates.ts` creates ordinary, editable CE.SDK blocks behind the page's other content. The page records `bestAgentMedia/templateId` and each block records `bestAgentMedia/templateSlot`. Both live only in the scene; the manifest and database are unchanged.
- **Restyling.** Applying a template to a page with content restyles that content story by story: earlier template slots and article-linked title text and images move into the new slots, keeping their links. Body columns are joined and reflowed into the new template's columns; text that no longer fits stays in the last column (clipped, not deleted). Empty slots are filled from the linked article: remaining photo slots from its other images, introduction or caption from its first paragraph, body from the rest, pull quote from the article's first blockquote (or, without one, a sentence picked from the body). Restyling reads each body column's inline styles, list styles and enlarged subheadings back from CE.SDK so the formatting survives the reflow. Content the new template has no slot for stays on the page as an ordinary block, as do ads and unlinked elements.
- **Filling from articles.** Dropping an article onto a templated page fills one story's headline, introduction or caption, body columns, pull quote and photos (the article's images in their saved order, one per photo slot), and links each block to the article, instead of adding loose blocks. The story is the one containing the selected template block, else the first story whose headline is still a placeholder, else story 1. Body text is split across the columns by an estimate of each column's current size and ends with "…" if the article is longer. CE.SDK text blocks do not link, so later edits do not reflow between columns.
- **Ads into picture placeholders.** Applying an ad from the Ads library while one picture placeholder is selected puts the ad's creative into that block, keeping its frame, and links it to the ad. A picture placeholder is a template image slot, or any image still showing the placeholder photo. The ad is fitted whole (`Contain`) so its artwork is never cropped, including when the template is reapplied. With no placeholder selected, the ad goes into the current page's first ad slot still showing the ad placeholder (`public/issue-templates/ad-placeholder.svg`); with no free ad slot, or for an ad without a creative, it is added as a new block as before. **Ad slots** (`role: "ad"`) are never filled with article text or photos. When a template with ad slots is applied, ads already on the page (in earlier slots or placed loosely) and whatever an earlier ad slot held move into its ad slots; templates without ad slots treat ads as photos, as before.
- **Labels** are fixed text slots that articles never fill, such as a masthead. `{publication}` and `{date}` in their text become the issue's publication name and month/year when the template is applied. A label edited on the page keeps its text when the template is reapplied. Slots with `autoFit` (masthead, cover line) use CE.SDK's automatic font size to shrink long text into the frame. `maxChars` shortens article text placed in a slot.
- **Page numbers** are text slots kept in step with page order by `syncTemplatePageNumbers` (run with the page rules after every edit), so manual edits to them are overwritten.
- **Fonts.** Typefaces are resolved by family name from the `ly.img.typeface` library; the first one found is used, falling back to the default typeface. Empty photo slots use `public/issue-templates/photo-placeholder.svg`.

To add a template, append it to `ISSUE_PAGE_TEMPLATES`. Slot IDs must stay stable once pages use them. Slot IDs must be unique within a template. A new template is offered to the Designer's composer automatically (`describeTemplates()`).

**Automatic composition (Generate Layout).** **Generate Layout** in the editor's save bar opens the shared `AgentPromptButton` dialog (Designer badge, optional custom instructions up to 2,000 characters), then calls `POST /api/issues/[id]/generate-layout` with `{ instructions }`. The route collects the publication (name, ZIP codes, cover image), the issue, **every article assigned to the issue** in the user's article scope (any status; drafts are flagged), and **every ad assigned to it except declined ones**. Each ad's size (full, half, quarter, eighth) comes from its style via `resolveAdPrintSpec` (no style: half page). The Designer task (`composeIssueLayout` in `src/lib/designer-composer.ts`) works like this:
- **Model.** By default Claude Opus 5.5 (`claude-opus-5-5`) at effort `high`, streamed with up to 128K output tokens. Server-side refusal fallbacks (`fallbacks: "default"`) and prompt caching are on. Designer settings `layoutModel`, `layoutEffort` and `layoutMaxOutputTokens` override this (`claude-fable-5-1` at `xhigh` is the most capable, but slower and dearer); the older `model`/`maxOutputTokens` keys are ignored. Migration `20261022090000_designer_layout_opus_5_5` moves rows still on the earlier Fable default to Opus 5.5.
- **Input.** Claude sees the publication's cover and up to 16 article lead photos (resized), every template's stories with estimated body capacity in words and its ad slot sizes, each article's word count, photo count, status, sponsorship and full Markdown text, and each ad's size and whether it has artwork.
- **Plan.** Claude returns a plan through the strict `submit_layout` tool: every page in print order, with its template, the article assigned to each story (optional cover lines and teasers), the ads for its ad slots in order, and a one-line note. It may also send `article_edits`: a fitted (shorter) version of an article's text, so the article fits its templates instead of spilling a few lines onto another page. A fitted text replaces the article's body in this layout only; the saved Article is unchanged. Edits carry over between turns until they are replaced or reverted (`body: null`). Beyond these, it writes no copy.
- **Checks.** `composeIssue()` in `src/lib/issue-composition.ts` checks the plan and simulates the text flow with the same column estimate the editor uses. The rules: cover first and back cover last; templates allowed on their page type; every story filled (extra cover teasers are optional); every ad placed exactly once, on an inner page (the covers never carry ads; the back cover always features an article); an ad template needs at least one ad, and an ad slot left free shows an unused article photo (a problem only when no unused photo is left); Designer-written teasers must fit their frame as complete sentences; every article printed **in full** (its original or fitted text) on inner pages; every photo printed once. `applyArticleEdits()` rejects a fitted text that is empty, longer than the original, or for an unknown article, and flags cuts of more than half the article for review. The cover and back cover only tease articles. **Photos** are allocated across the issue by `composeIssue()`: the cover's lead story and a featured back-cover story reserve their article's first free photos, inner pages then take the rest in order, and any photo slot, or ad slot whose ad has no artwork, that is still empty is filled with an unused photo of another article. A photo is repeated only when none is left, and the task notes say so. An article's text continues automatically through every later story assigned to it ("(continued)" headlines, "Continued from page N" introductions). Problems go back to Claude as an error `tool_result` for another turn, up to 5 turns. Non-blocking notes (placeholder photos, size mismatches, ads without artwork) get one refinement turn.
- **Fallback.** If no valid plan arrives, `repairPlan()` completes the last one: it fixes order and templates, drops invalid assignments and text edits, adds ad pages and article pages for anything left out, and inserts **Text columns** pages until all text fits. The task result says so (`outcome` `repaired`/`fallback`, `repairs`).

The result (`contentType: "layout-composition"`) stores the plan and the resolved `composition` (format `"composition"`). That is the exact content of every slot of every page: text, rich body paragraphs, photo and ad URLs and content links. The task page shows the composition in a read-only CE.SDK viewer (`src/components/layout-scene-viewer.tsx`, Viewer role, no dock or inspector) built with the same `buildSceneFromComposition()` as the editor, so positions, typefaces and crops match the applied layout. It also lists the summary, corrections, notes and every fitted text (`textEdits`: article, original and fitted word counts, reason). **Apply to issue** (the redeploy endpoint) writes the composition to `Issue.designJson`. When the issue is opened, `buildSceneFromComposition()` (`src/lib/cesdk-issue-templates.ts`) creates ordinary template blocks with that content, linked to their articles and ads. The cover and back cover keep their page IDs, and inner pages reuse existing inner IDs and then get new ones. The editor saves straight away, which stores a CE.SDK document and adds the new IssuePage rows. The composition is a snapshot of the content when the task ran.

The navigation bar's actions menu (`src/lib/cesdk-issue-files.ts`) exports locally in the browser and downloads the file; nothing is uploaded or sent:
- the current page as PNG, JPEG, WebP, TGA, SVG or MP4;
- the whole issue as one multi-page PDF;
- audio blocks as WAV/M4A (only present in imported scenes);
- the scene as `.imgly`, or an archive `.imgly` with embedded assets.

Importing a scene or archive (`.imgly`, `.scene`, `.zip`) replaces the layout after confirmation. `adoptImportedScene` maps the imported pages onto the issue's page IDs by position (first page = cover, last = back cover) and adds blank pages until there are at least three. It strips links to articles or ads outside the issue's libraries. Archive-embedded images are uploaded to the issue media folder and relocated. Other embedded assets, such as fonts or video, are reported as not stored. If the import fails, the previous scene is restored. Issue image uploads accept SVG as well as JPEG, PNG and WebP. The image route serves files with a sandboxing `Content-Security-Policy`.

`Issue.designJson` holds one of three formats (see `src/lib/issue-design.ts`):
- **CE.SDK document** (`format: "cesdk"`), written by the editor. It contains the opaque `engine.scene.saveToString()` result plus a `pages` manifest of page IDs and linked elements derived from block metadata. The server validates the manifest without decoding the scene.
- **Composition** (`format: "composition"`), a Designer layout applied from its task page (see Automatic composition above). The editor builds it into template pages on open and saves it as a CE.SDK document.
- **Layout specification** with simple `text`/`image` elements. Designer tasks created before automatic composition stored this format, and **Apply to issue** still writes it for them. Designs saved before the CE.SDK migration (Polotno JSON) also use it. The editor converts a layout specification into a CE.SDK scene when the issue is opened, and the next save stores it as a CE.SDK document; no data migration is required.

The migration `20261012145000_issue_combined_design` removed `IssuePage.designJson`. Do not restore per-page persistence unless the data model and migration strategy are intentionally redesigned.

`PATCH /api/issues/[id]/design` is the aggregate persistence endpoint and only accepts the CE.SDK document format. It validates:
- authentication, role, and issue scope;
- JSON size (5 MB maximum) and shape;
- page IDs and cover/back-cover placement;
- that linked articles and ads are available within the Issue's publication.

It reconciles IssuePage rows in canvas order and rebuilds IssuePagePlacement records transactionally. New pages use their metadata IDs as database IDs. `GET /api/issues/[id]/images/[filename]` serves issue assets after checking issue access. Preserve the invariant that the cover remains first, the back cover remains last, and at least one inner page remains.

CE.SDK runs without a license key in evaluation mode, which watermarks exports. `NEXT_PUBLIC_CESDK_LICENSE` is optional; do not add a hard license gate that prevents the local prototype from loading. The editor currently uses CE.SDK's default asset location, the IMG.LY CDN, for engine WASM, fonts, UI assets, and default libraries (typefaces, shapes, stickers, filters). IMG.LY documents that location as intended for development only. For self-hosting, download the `imgly-assets.zip` archive that matches the installed SDK version and serve it from the app, for example `public/cesdk/<version>/`. Then pass that location as `baseURL` to `CreativeEditorSDK.create` and as `baseURL` to each asset-source plugin.

## Ad generation print sizes

Creative ad generation (`POST /api/creative/generate-ad` → `launchGenerateAd` in `src/lib/creative-agent.ts`) designs for print. The prompt carries the ad fields, the advertiser's details (including the address, phone and website used for booking), and the publication and issue context. `src/lib/ad-print-specs.ts` maps the ad's style (its `PromotionPackage` name, falling back to `Advertisement.styleName`) to a fixed size on the 8.5 x 11 in page: full page 8.5 x 11 (full bleed), half page 7.5 x 4.875, quarter page 3.625 x 4.875, eighth page/business card 3.625 x 2.375. The editor's custom instructions override the style: a named size ("quarter page", "business card") or exact inches ("5 x 7 in", width first, 1–17 in a side). When neither names a size, which includes ads with no style, the ad is a half page. The editor's instructions also take precedence over the prompt's margin, copy and type guidance, but not over its content rules (no invented contact details, no publication or issue text). Gemini renders at the closest supported aspect ratio, and the result is centre-cropped to the exact size at 300 dpi. On the task page, **Iterate** (`iterateFromTaskId`) sends the generated ad back to the Creative as the first image to revise. It keeps the size stored in the result's `printSpec` unless the new instructions name another size. **Generate again** starts over from the same reference images.

## Tasks (long-running operations)

Every operation that is not resolved instantly is a **Task**: agent jobs (Designer layouts, Creative image enhancement and ad generation, Copywriter reviews and applied revisions, Assistant clarification drafts, Marketer pitches and advertiser review/promotion conversations, automatic invites), business imports, and business onboarding (reachout). Follow this architecture for any new long-running feature:

- **Never block the UI.** The launch endpoint validates the request, records the task, runs the work in the background with `after()` from `next/server`, and responds immediately (HTTP 202) with the registry task `{ task: { id, name } }` (or `{ tasks: [...] }`). Do not await model calls in the request, and do not show spinner modals or result dialogs. A dialog that only collects options before launch is fine.
- **Announce, don't wait.** Client launchers call `announceTaskStarted()` from `src/lib/task-events.ts`, or use the `useTaskLauncher()` hook in `src/components/use-task-launcher.ts`. `TaskNotifier` (mounted in the workspace layout) shows a "started" toast. It polls `GET /api/tasks/notifications` and shows a notification at the top of the screen when the user's task succeeds, fails, or stops. Clicking it opens `/tasks/[id]`. Each completion is announced once, because the endpoint atomically sets `Task.notifiedAt`.
- **One list.** `/tasks` (the **Tasks** link at the bottom of the sidebar) lists tasks sortable by name, date, agent type (may be None), and status. Statuses are labelled Queued, Ongoing, Success, Error, and Stopped (`src/lib/task-status.ts`). Administrators see all tasks; other users see the tasks they launched (`getTaskScope` in `src/lib/tasks.ts`).
- **Show the agent.** Every task creation screen that involves an agent or sub-agent renders `<AgentBadge agentSlug="…" />` (`src/components/agent-badge.tsx`) with the agent's picture and name. It links to `/tasks?agent=<id>` (plus `&subAgent=<id>` for a sub-agent), which lists only that agent's tasks. Identities come from `GET /api/agents/directory`; picture GET routes are readable by any signed-in user.
- **One page per template.** `/tasks/[id]` chooses a template with `getTaskTemplate()`:
  - `layout`: page previews plus **Apply to issue**.
  - `creative`: original versus result, with Discard / Overwrite / Keep / Iterate.
  - `email-draft`: the draft plus **Send email** (administrators).
  - `review`: editorial feedback.
  - Info requests (`POST /api/submissions/[id]/clarify`, Assistant): the Assistant never edits a submission's title or body. `handleClarificationReply` (`src/lib/clarification-reply.ts`) extracts what each reply contains into the request's `receivedInfo` (`{ topic, detail, messageId, receivedAt }`), which the review card shows under **Information from the submitter** and which re-reviews, follow-ups and Apply read (`getSubmissionReceivedInfo`). Only photo attachments are added to the submission directly.
  - `revision`: a Copywriter revision of a submission (**Apply** on a review, `POST /api/submissions/[id]/apply`), drafted from the submission, the review, the info-request conversation and optional custom instructions. The current and proposed title and body are shown side by side with word-level highlights; **Accept & overwrite** or **Discard** (`POST /api/submissions/[id]/apply/[taskId]`) resolves it. The result keeps `proposedTitle`/`proposedBody`, `previousTitle`/`previousBody` (the version it was drafted from) and `status` (`pending_review`, `accepted`, `discarded`). Accepting after the submission was edited asks for confirmation (`force`), and the replaced text is kept as `replacedTitle`/`replacedBody`.
  - `promotion`: advertiser review and paid promotion status (`PromotionDeal`), stays Ongoing while the conversation is open.
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
