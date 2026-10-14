import Link from "next/link";

export function BusinessesSectionNav({
  current,
}: {
  current: "businesses" | "import" | "reachout";
}) {
  return (
    <nav aria-label="Business sections" className="businesses-section-nav">
      <Link
        aria-current={current === "businesses" ? "page" : undefined}
        className={current === "businesses" ? "businesses-section-link-active" : ""}
        href="/businesses"
      >
        Businesses
      </Link>
      <Link
        aria-current={current === "import" ? "page" : undefined}
        className={current === "import" ? "businesses-section-link-active" : ""}
        href="/businesses/import/new"
      >
        Import
      </Link>
      <Link
        aria-current={current === "reachout" ? "page" : undefined}
        className={current === "reachout" ? "businesses-section-link-active" : ""}
        href="/businesses/reachout"
      >
        Outreach
      </Link>
    </nav>
  );
}
