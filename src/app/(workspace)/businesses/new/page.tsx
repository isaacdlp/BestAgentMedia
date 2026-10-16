import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { createBusiness } from "@/app/actions/businesses";
import { BusinessesSectionNav } from "@/components/businesses-section-nav";
import { requireUser } from "@/lib/auth";

export default async function NewBusinessPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/businesses">
            ← All businesses
          </Link>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Create business</h1>
          <p className="muted">Add a business to the directory.</p>
        </div>
      </div>
      <BusinessesSectionNav current="businesses" />
      <section className="panel">
        <form action={createBusiness} className="business-form">
          <div className="business-form-grid">
            <label className="business-field">
              <span>Business name</span>
              <input autoComplete="organization" maxLength={200} name="name" required />
            </label>
            <label className="business-field">
              <span>Primary category</span>
              <input name="primaryCategory" />
            </label>
            <label className="business-field business-field-wide">
              <span>Categories (one per line)</span>
              <textarea name="categories" rows={3} />
            </label>
            <label className="business-field">
              <span>Address label</span>
              <input autoComplete="street-address" name="addressLabel" />
            </label>
            <label className="business-field">
              <span>House number</span>
              <input name="houseNumber" />
            </label>
            <label className="business-field">
              <span>Street</span>
              <input name="street" />
            </label>
            <label className="business-field">
              <span>City</span>
              <input autoComplete="address-level2" name="city" />
            </label>
            <label className="business-field">
              <span>State</span>
              <input autoComplete="address-level1" name="state" />
            </label>
            <label className="business-field">
              <span>State code</span>
              <input name="stateCode" />
            </label>
            <label className="business-field">
              <span>Postal code</span>
              <input autoComplete="postal-code" inputMode="numeric" maxLength={5} name="postalCode" pattern="[0-9]{5}" title="Exactly 5 digits" />
            </label>
            <label className="business-field">
              <span>Country code</span>
              <input autoComplete="country" maxLength={2} name="countryCode" />
            </label>
            <label className="business-field">
              <span>Latitude</span>
              <input max={90} min={-90} name="latitude" step="any" type="number" />
            </label>
            <label className="business-field">
              <span>Longitude</span>
              <input max={180} min={-180} name="longitude" step="any" type="number" />
            </label>
            <label className="business-field">
              <span>Phone</span>
              <input autoComplete="tel" name="phone" type="tel" />
            </label>
            <label className="business-field">
              <span>Email</span>
              <input autoComplete="email" name="email" type="email" />
            </label>
            <label className="business-field business-field-wide">
              <span>Website</span>
              <input autoComplete="url" name="website" type="url" />
            </label>
          </div>
          <div className="business-form-footer">
            <p className="muted">This business will be marked as manually added.</p>
            <div className="business-form-actions">
              <Link className="text-link" href="/businesses">
                Cancel
              </Link>
              <button className="button button-primary" type="submit">
                Create business
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}
