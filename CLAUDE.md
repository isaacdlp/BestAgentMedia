# BestAgentMedia Project Intent

## Developer handover

For the current application architecture, setup/validation commands, authorization and ID conventions, data and media locations, migration notes, Issue/CreativeEditor (CE.SDK) persistence, and known implementation gaps, read [DEVELOPMENT.md](./DEVELOPMENT.md). Use [README.md](./README.md) for first-run setup and feature documentation. Never open or copy `.env` values; use `.env.example` only to identify configuration names.

## Purpose

Build a functional demo of an agent-assisted platform for Best Version Media. The platform should help a local publication team discover and evaluate community stories, find potential local advertisers, and prepare publication materials. Agents may act independently, including emailing and corresponding with submitters and businesses, without waiting for human approval.

## Intended workflow

1. **Receive story submissions.** Support submissions made through Best Version Media's content submission form, including the example publication at `https://www.bestversionmedia.com/submit-content/?postal_code=33446&publication=1352`.
2. **Clarify submissions.** Identify missing or ambiguous information and prepare a request for clarification to the submitter. Keep the conversation associated with the submission.
3. **Scout local stories.** Independently find other potentially relevant local stories and record where each candidate came from.
4. **Rank story candidates.** Evaluate submitted and discovered stories against transparent criteria. Show the criteria and reasoning behind a ranking so a publication team can review it; do not present a ranking as a final editorial decision.
5. **Find potential advertisers.** Research local businesses that may be a fit for the publication and build an organized, reviewable database of prospects. Keep relevant business details and their sources together.
6. **Prepare advertising outreach.** Draft a tailored advertising proposal for suitable businesses and direct interested businesses to the appropriate ad-submission form. Agents may send outreach and reply to businesses on their own.
7. **Assemble a proposed issue.** Organize selected stories and ads into a draft publication layout, including associated images.
8. **Draft a cover.** Create a cover concept for the proposed issue.

## Agent autonomy and traceability

- Agents are free to act independently, including sending emails and replying to people, without a human approval step.
- Make generated recommendations and drafts distinguishable from approved or published content.
- Record what agents send (threads, task steps) so people can see what happened after the fact.
- Preserve source information and the reasoning needed for a person to verify discovered stories and business prospects.
- Treat personal and business contact information as sensitive; collect and retain only information needed for the demo workflow.

## Publication assets

The proposed layout and cover must be editable by people after generation, not just rendered as flattened images. Prefer a structured, layered or vector-based format that can be revised in a professional design tool (for example, an Illustrator-compatible format or an equivalent). Keep text, images, and layout elements independently editable where practical, and retain links or references to the source assets.

## Demo principles

- Optimize for a coherent end-to-end demonstration of the workflow, with clear status and handoffs between stages.
- Make generated content, research results, rankings, and outreach drafts reviewable and traceable to their inputs.
- Clearly distinguish real integrations from sample, mocked, or generated demo data; do not imply that an external service was contacted when it was not.
- Keep implementation choices consistent with the existing project and avoid committing credentials or other secrets.

## React form controls

- For editable fields managed by React state, provide both `value` (or `checked`) and an `onChange` handler.
- For uncontrolled fields, use `defaultValue` (or `defaultChecked`) instead of `value` (or `checked`).
- For immutable fields, mark them `readOnly` (or `disabled` when they should not participate in form submission).
- Before finishing UI changes, check that no editable form control has a `value` or `checked` prop without its corresponding change handler.

## Internal record IDs

- Always use sequential numeric database primary keys for internal record IDs and navigation.
- Store external/provider identifiers separately; never use them as a database record ID or route key.
- When converting an existing primary key, migrate every foreign-key reference without losing or reassigning related records.

## Publication location

- Publications use their associated five-digit ZIP codes as their only location data.
- Do not add City or State fields to the Publication schema or its forms; retain City and State fields for Business records where applicable.

## List search

- Search inputs on list pages must query the whole dataset on the server (or API), never only the rows on the current page, and must reset to page 1 when the query changes.
- Search must match every field a person can see in the row or would reasonably search by, including related records and provider/source labels (for example a task's source system, ZIP code, categories, or business name), not just the display name.
- Before finishing, verify that a record known to be on a late page is found by a search on a visible attribute.

## Image upload areas

- Every image upload UI must use the shared `ImageDropzone` component (`src/components/image-dropzone.tsx`): a dashed drop zone with click-to-browse, drag-and-drop, inline validation, and a removable list of the chosen files. Never ship a bare `<input type="file">` or a "Choose file" button for images.
- Use `multiple={false}` and `compact` for single pictures (avatars, covers), pass `name` when the files are submitted by a native form, and use `maxFiles`/`maxFileBytes`/`accept` for limits rather than hand-written validation.
- Styles live under the `.dropzone*` classes in `globals.css`; extend those instead of creating one-off upload styles.
