"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { ImageDropzone } from "@/components/image-dropzone";

type PublicationOption = {
  id: number;
  name: string;
  coverUrl: string | null;
};

type StoryType =
  | "community"
  | "family"
  | "event"
  | "organization"
  | "pet"
  | "sports"
  | "announcement"
  | "other";

const storyTypes: { value: StoryType; label: string }[] = [
  { value: "community", label: "Community spotlight" },
  { value: "family", label: "People and families" },
  { value: "event", label: "Local event" },
  { value: "organization", label: "Community organization" },
  { value: "pet", label: "Pets" },
  { value: "sports", label: "Local sports" },
  { value: "announcement", label: "Community announcement" },
  { value: "other", label: "Other story" },
];

export function PublicSubmissionForm({
  initialContact,
  initialPostalCode,
  initialPublicationId,
}: {
  initialContact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  initialPostalCode: string;
  initialPublicationId: number | null;
}) {
  const [step, setStep] = useState(0);
  const [postalCode, setPostalCode] = useState(initialPostalCode);
  const [publications, setPublications] = useState<PublicationOption[]>([]);
  const [publicationId, setPublicationId] = useState("");
  const [storyType, setStoryType] = useState<StoryType | "">("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [firstName, setFirstName] = useState(initialContact.firstName);
  const [lastName, setLastName] = useState(initialContact.lastName);
  const [email, setEmail] = useState(initialContact.email);
  const [phone, setPhone] = useState(initialContact.phone);
  const [images, setImages] = useState<File[]>([]);
  const [consent, setConsent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingPublications, setLoadingPublications] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isComplete = notice !== null;

  const findPublications = useCallback(
    async (code: string, preferredId: number | null = null) => {
      setError(null);
      setPublications([]);
      setPublicationId("");
      if (!/^\d{5}$/.test(code)) {
        setError("Enter a valid five-digit ZIP code.");
        return;
      }

      setLoadingPublications(true);
      try {
        const response = await fetch(
          `/api/public/submissions/publications?postal_code=${encodeURIComponent(code)}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as
          | PublicationOption[]
          | { error: string };
        if (!response.ok || !Array.isArray(result)) {
          throw new Error(
            !Array.isArray(result) && "error" in result
              ? result.error
              : "Unable to find publications for that ZIP code.",
          );
        }
        setPublications(result);
        const preferredPublication = result.find(
          (publication) => publication.id === preferredId,
        );
        if (preferredPublication) {
          setPublicationId(String(preferredPublication.id));
        } else if (result.length === 1) {
          setPublicationId(String(result[0].id));
        }
        if (!result.length) {
          setError("No publications serve that ZIP code yet.");
        }
      } catch (lookupError) {
        console.error("Public submission publication lookup failed:", lookupError);
        setError(
          lookupError instanceof Error
            ? lookupError.message
            : "Unable to find publications for that ZIP code.",
        );
      } finally {
        setLoadingPublications(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initialPostalCode) {
      void findPublications(initialPostalCode, initialPublicationId);
    }
  }, [findPublications, initialPostalCode, initialPublicationId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (step === 0) {
      if (!publications.length || !publicationId) {
        setError("Find your ZIP code and choose a publication to continue.");
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!storyType) {
        setError("Choose a story category to continue.");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (
        !title.trim() ||
        !body.trim() ||
        !firstName.trim() ||
        !lastName.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ) {
        setError(
          "Complete the required story and contact fields with a valid email address to continue.",
        );
        return;
      }
      setStep(3);
      return;
    }
    if (!consent) {
      setError("Confirm that the publication team may contact you about this story.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("postalCode", postalCode);
      formData.set("publicationId", publicationId);
      formData.set("storyType", storyType);
      formData.set("title", title);
      formData.set("body", body);
      formData.set("firstName", firstName);
      formData.set("lastName", lastName);
      formData.set("email", email);
      formData.set("phone", phone);
      formData.set("consent", String(consent));
      images.forEach((image) => formData.append("images", image));
      const response = await fetch("/api/public/submissions", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as { message?: string; error?: string };
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? "Unable to submit your story.");
      }
      setNotice(result.message);
    } catch (submitError) {
      console.error("Public content submission failed:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit your story. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedPublication = publications.find(
    (publication) => String(publication.id) === publicationId,
  );
  const selectedStoryType = storyTypes.find((type) => type.value === storyType);

  return (
    <section className="public-submission-card">
      {isComplete ? (
        <div aria-live="polite" className="public-submission-success" role="status">
          <span className="public-submission-success-mark" aria-hidden="true">✓</span>
          <h2>Thanks for sharing your story.</h2>
          <p>{notice}</p>
          <p className="muted">
            The local team will review your submission and reach out if they
            need more information.
          </p>
        </div>
      ) : (
        <>
          <ol aria-label="Submission progress" className="public-submission-steps">
            {["Location", "Story type", "Story details", "Review"].map(
              (label, index) => (
                <li
                  aria-current={step === index ? "step" : undefined}
                  className={index <= step ? "public-submission-step-active" : ""}
                  key={label}
                >
                  <span>{index + 1}</span>
                  <small>{label}</small>
                </li>
              ),
            )}
          </ol>
          <form className="public-submission-form" noValidate onSubmit={handleSubmit}>
            {step === 0 ? (
              <div className="public-submission-step-content">
                <h2>Choose a publication</h2>
                <p className="muted">
                  Enter the ZIP code where the story takes place to find local
                  publications.
                </p>
                <div className="business-field">
                  <label htmlFor="submission-postal-code">
                    <span>ZIP code <b aria-hidden="true">*</b></span>
                  </label>
                  <div className="public-submission-zip-row">
                    <input
                      autoComplete="postal-code"
                      id="submission-postal-code"
                      inputMode="numeric"
                      maxLength={5}
                      onChange={(event) => {
                        setPostalCode(event.target.value.replace(/\D/g, ""));
                        setPublications([]);
                        setPublicationId("");
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void findPublications(postalCode);
                        }
                      }}
                      pattern="\d{5}"
                      placeholder="Enter a ZIP code"
                      required
                      value={postalCode}
                    />
                    <button
                      className="button button-secondary"
                      disabled={loadingPublications || postalCode.length !== 5}
                      onClick={() => void findPublications(postalCode)}
                      type="button"
                    >
                      {loadingPublications ? "Searching…" : "Find"}
                    </button>
                  </div>
                </div>
                {publications.length ? (
                  <fieldset className="business-field public-submission-publications">
                    <legend>Choose a publication <b aria-hidden="true">*</b></legend>
                    <div className="public-submission-publication-grid">
                      {publications.map((publication) => (
                        <button
                          aria-pressed={publicationId === String(publication.id)}
                          className={
                            publicationId === String(publication.id)
                              ? "public-submission-publication-card public-submission-publication-card-selected"
                              : "public-submission-publication-card"
                          }
                          key={publication.id}
                          onClick={() => {
                            setPublicationId(String(publication.id));
                            setError(null);
                          }}
                          type="button"
                        >
                          {publication.coverUrl ? (
                            <Image
                              alt={`${publication.name} cover`}
                              className="public-submission-publication-cover"
                              src={publication.coverUrl}
                              height={350}
                              width={250}
                              unoptimized
                            />
                          ) : (
                            <span aria-hidden="true" className="public-submission-publication-cover-placeholder">
                              {publication.name.slice(0, 1)}
                            </span>
                          )}
                          <span className="public-submission-publication-name">
                            {publication.name}
                          </span>
                          {publicationId === String(publication.id) ? (
                            <span aria-hidden="true" className="public-submission-publication-selected-mark">✓</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="public-submission-step-content">
                <h2>What is your story about?</h2>
                <p className="muted">
                  Choose the category that best describes the story.
                </p>
                <div className="public-submission-story-types">
                  {storyTypes.map((type) => (
                    <label
                      className={
                        storyType === type.value
                          ? "public-submission-story-type public-submission-story-type-selected"
                          : "public-submission-story-type"
                      }
                      key={type.value}
                    >
                      <input
                        checked={storyType === type.value}
                        name="storyType"
                        onChange={() => setStoryType(type.value)}
                        required
                        type="radio"
                        value={type.value}
                      />
                      <span>{type.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="public-submission-step-content">
                <h2>Tell us about your story</h2>
                <p className="muted">
                  Share the details you would like the local editorial team to
                  consider.
                </p>
                <label className="business-field" htmlFor="submission-title">
                  <span>Story title <b aria-hidden="true">*</b></span>
                  <input
                    id="submission-title"
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label className="business-field" htmlFor="submission-body">
                  <span>Story details <b aria-hidden="true">*</b></span>
                  <textarea
                    id="submission-body"
                    maxLength={20_000}
                    onChange={(event) => setBody(event.target.value)}
                    required
                    rows={7}
                    value={body}
                  />
                </label>
                <div className="business-field">
                  <span>Story images (optional)</span>
                  <p className="muted">
                    Add up to five JPEG, PNG, or WebP images. Each image can be
                    up to 10 MB.
                  </p>
                  <ImageDropzone
                    files={images}
                    maxFiles={5}
                    onChange={(files) => {
                      setImages(files);
                      setError(null);
                    }}
                  />
                </div>
                <h3>Your contact information</h3>
                <div className="business-form-grid">
                  <label className="business-field">
                    <span>First name <b aria-hidden="true">*</b></span>
                    <input
                      autoComplete="given-name"
                      onChange={(event) => setFirstName(event.target.value)}
                      required
                      value={firstName}
                    />
                  </label>
                  <label className="business-field">
                    <span>Last name <b aria-hidden="true">*</b></span>
                    <input
                      autoComplete="family-name"
                      onChange={(event) => setLastName(event.target.value)}
                      required
                      value={lastName}
                    />
                  </label>
                  <label className="business-field">
                    <span>Email <b aria-hidden="true">*</b></span>
                    <input
                      autoComplete="email"
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      type="email"
                      value={email}
                    />
                  </label>
                  <label className="business-field">
                    <span>Phone (optional)</span>
                    <input
                      autoComplete="tel"
                      onChange={(event) => setPhone(event.target.value)}
                      type="tel"
                      value={phone}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="public-submission-step-content">
                <h2>Review your submission</h2>
                <p className="muted">
                  Check these details before sending your story to the local team.
                </p>
                <dl className="public-submission-review">
                  <div><dt>ZIP code</dt><dd>{postalCode}</dd></div>
                  <div><dt>Publication</dt><dd>{selectedPublication?.name}</dd></div>
                  <div><dt>Story category</dt><dd>{selectedStoryType?.label}</dd></div>
                  <div><dt>Title</dt><dd>{title}</dd></div>
                  <div><dt>Story details</dt><dd className="public-submission-review-body">{body}</dd></div>
                  {images.length ? (
                    <div>
                      <dt>Images</dt>
                      <dd>{images.map((image) => image.name).join(", ")}</dd>
                    </div>
                  ) : null}
                  <div><dt>Submitted by</dt><dd>{firstName} {lastName}</dd></div>
                  <div><dt>Email</dt><dd>{email}</dd></div>
                  {phone ? <div><dt>Phone</dt><dd>{phone}</dd></div> : null}
                </dl>
                <label className="public-submission-consent">
                  <input
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    The publication team may contact me about this story.
                  </span>
                </label>
              </div>
            ) : null}

            {error ? (
              <p aria-live="polite" className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="public-submission-actions">
              {step > 0 ? (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setError(null);
                    setStep((current) => current - 1);
                  }}
                  type="button"
                >
                  Back
                </button>
              ) : <span />}
              <button
                className="button button-primary"
                disabled={submitting || loadingPublications}
                type="submit"
              >
                {submitting
                  ? "Submitting…"
                  : step === 3
                    ? "Submit story"
                    : `Continue to ${["", "story type", "story details", "review"][step + 1]}`}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

