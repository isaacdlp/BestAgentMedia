import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stories Start Here | BestAgentMedia",
  description:
    "Celebrate the people, places, and moments that make your neighborhood special. Share your story with a local publication.",
};

const storyIdeas = [
  {
    number: "01",
    title: "People who inspire",
    description:
      "Shine a light on a neighbor, mentor, or family making a difference close to home.",
  },
  {
    number: "02",
    title: "Good things happening",
    description:
      "Tell us about a local event, community group, school, team, or cause worth celebrating.",
  },
  {
    number: "03",
    title: "The little things",
    description:
      "From a beloved pet to a new tradition, the details are what make a neighborhood yours.",
  },
];

export default function HomePage() {
  return (
    <main className="marketing-home">
      <header className="marketing-header">
        <Link aria-label="BestAgentMedia home" className="marketing-brand" href="/">
          <span aria-hidden="true" className="brand-mark">B</span>
          <span>BestAgentMedia</span>
        </Link>
        <nav aria-label="Main navigation" className="marketing-nav">
          <a href="#our-approach">Our approach</a>
          <a href="#story-ideas">Story ideas</a>
          <Link className="marketing-login-link" href="/login">
            Sign in
          </Link>
        </nav>
        <Link className="button button-primary marketing-header-cta" href="/submit-content">
          Share your story
        </Link>
      </header>

      <section className="marketing-hero">
        <div aria-hidden="true" className="marketing-hero-glow marketing-hero-glow-one" />
        <div aria-hidden="true" className="marketing-hero-glow marketing-hero-glow-two" />
        <div className="marketing-hero-inner">
          <div className="marketing-hero-copy">
            <p className="marketing-eyebrow">
              <span aria-hidden="true" /> MADE FOR THE NEIGHBORHOOD
            </p>
            <h1>
              Every community
              <br />
              has a story.
              <br />
              <em>Let’s tell yours.</em>
            </h1>
            <p className="marketing-hero-description">
              The best local stories begin with the people who live them. Share
              a moment, a milestone, or someone who makes your corner of the
              world feel like home.
            </p>
            <div className="marketing-hero-actions">
              <Link className="button button-primary marketing-hero-button" href="/submit-content">
                Submit a community story <span aria-hidden="true">→</span>
              </Link>
              <a className="marketing-secondary-link" href="#our-approach">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <div className="marketing-trust-note">
              <span aria-hidden="true" className="marketing-people-icon">
                <span>●</span><span>●</span><span>●</span>
              </span>
              <span>Local voices. Real neighbors. Stories with heart.</span>
            </div>
          </div>
          <div aria-label="A collection of local community magazine covers" className="marketing-cover-scene" role="img">
            <div className="marketing-cover-back marketing-cover-left">
              <span>NEIGHBORS</span>
              <strong>Good things<br />grow here.</strong>
              <i>LOCAL STORIES · LOCAL PEOPLE</i>
            </div>
            <div className="marketing-cover-back marketing-cover-right">
              <span>COMMUNITY</span>
              <strong>Made of<br />many stories.</strong>
              <i>YOUR TOWN, TOGETHER</i>
            </div>
            <div className="marketing-cover-main">
              <div className="marketing-cover-photo" />
              <div className="marketing-cover-title">
                <span>THE PLACE WE CALL HOME</span>
                <strong>Meet the<br />neighbors<br />next door.</strong>
                <i>A magazine for the community</i>
              </div>
              <span className="marketing-cover-seal">LOCAL<br />& LOVELY</span>
            </div>
            <div className="marketing-cover-caption">
              <span aria-hidden="true">✦</span>
              The moments that bring us closer
            </div>
          </div>
        </div>
        <div className="marketing-hero-bottom">
          <span>GOOD STORIES LIVE RIGHT HERE</span>
          <span aria-hidden="true">✳</span>
          <span>START WITH YOUR NEIGHBORHOOD</span>
        </div>
      </section>

      <section className="marketing-intro" id="our-approach">
        <div className="marketing-section-label">A LITTLE CLOSER TO HOME</div>
        <h2>
          Big stories don’t have to happen
          <br />
          <span>somewhere else.</span>
        </h2>
        <p>
          They happen on your street, at the school game, around the dinner
          table, and wherever people show up for one another. We help local
          communities share those stories—and see themselves in every issue.
        </p>
      </section>

      <section className="marketing-story-ideas" id="story-ideas">
        <div className="marketing-story-ideas-heading">
          <div>
            <p className="marketing-section-label">WHAT MAKES YOUR TOWN, YOUR TOWN?</p>
            <h2>It could start with <em>you.</em></h2>
          </div>
          <p>
            Not sure what to share? Here are a few of the things neighbors love
            to read about.
          </p>
        </div>
        <div className="marketing-story-grid">
          {storyIdeas.map((idea) => (
            <article className="marketing-story-card" key={idea.number}>
              <span className="marketing-story-number">{idea.number}</span>
              <h3>{idea.title}</h3>
              <p>{idea.description}</p>
              <span aria-hidden="true" className="marketing-story-spark">✳</span>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-cta">
        <div aria-hidden="true" className="marketing-cta-mark">B</div>
        <p className="marketing-section-label">YOUR NEIGHBORS ARE LISTENING</p>
        <h2>Your story belongs here.</h2>
        <p>
          Take a few minutes to tell us what makes your community special.
          We’ll make sure it reaches the right local publication.
        </p>
        <Link className="button marketing-cta-button" href="/submit-content">
          Start your submission <span aria-hidden="true">→</span>
        </Link>
        <span className="marketing-cta-footnote">A simple way to celebrate where you live.</span>
      </section>

      <footer className="marketing-footer">
        <Link aria-label="BestAgentMedia home" className="marketing-brand" href="/">
          <span aria-hidden="true" className="brand-mark">B</span>
          <span>BestAgentMedia</span>
        </Link>
        <p>Stories that make a neighborhood feel like home.</p>
        <div>
          <Link href="/submit-content">Submit a story</Link>
          <Link href="/login">Sign in</Link>
        </div>
        <small>© {new Date().getFullYear()} BestAgentMedia</small>
      </footer>
    </main>
  );
}
