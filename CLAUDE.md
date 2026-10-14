# BestAgentMedia Project Intent

## Developer handover

For the current application architecture, setup/validation commands, authorization and ID conventions, data and media locations, migration notes, Issue/Polotno persistence, and known implementation gaps, read [DEVELOPMENT.md](./DEVELOPMENT.md). Use [README.md](./README.md) for first-run setup and feature documentation. Never open or copy `.env` values; use `.env.example` only to identify configuration names.

## Purpose

Build a functional demo of an agent-assisted platform for Best Version Media. The platform should help a local publication team discover and evaluate community stories, find potential local advertisers, and prepare publication materials. It should assist people rather than replace editorial judgment or silently take external actions.

## Intended workflow

1. **Receive story submissions.** Support submissions made through Best Version Media's content submission form, including the example publication at `https://www.bestversionmedia.com/submit-content/?postal_code=33446&publication=1352`.
2. **Clarify submissions.** Identify missing or ambiguous information and prepare a request for clarification to the submitter. Keep the conversation associated with the submission.
3. **Scout local stories.** Independently find other potentially relevant local stories and record where each candidate came from.
4. **Rank story candidates.** Evaluate submitted and discovered stories against transparent criteria. Show the criteria and reasoning behind a ranking so a publication team can review it; do not present a ranking as a final editorial decision.
5. **Find potential advertisers.** Research local businesses that may be a fit for the publication and build an organized, reviewable database of prospects. Keep relevant business details and their sources together.
6. **Prepare advertising outreach.** Draft a tailored advertising proposal for suitable businesses and direct interested businesses to the appropriate ad-submission form. The publication team should be able to review and approve outreach before any real email is sent.
7. **Assemble a proposed issue.** Organize selected stories and ads into a draft publication layout, including associated images.
8. **Draft a cover.** Create a cover concept for the proposed issue.

## Human review and external actions

- Keep people in control of editorial selection, advertiser qualification, publication layout, cover approval, and all real-world communications.
- Make generated recommendations and drafts distinguishable from approved or published content.
- Do not send emails, submit forms, publish content, or otherwise contact people as an implicit side effect of generating a draft. External actions must be explicit and reviewable.
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
