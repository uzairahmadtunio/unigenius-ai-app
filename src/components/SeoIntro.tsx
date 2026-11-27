interface SeoIntroProps {
  heading: string;
  paragraphs: string[];
}

/**
 * Explanatory copy block for public listing pages (Full SEO program,
 * Phase 2). Several public pages were little more than a search box
 * and a grid (~200 rendered characters); this adds honest, useful
 * descriptive copy with a proper H2 at the foot of the page.
 */
const SeoIntro = ({ heading, paragraphs }: SeoIntroProps) => (
  <section className="mt-10 glass rounded-2xl border border-border p-5 md:p-6">
    <h2 className="font-display font-bold text-base md:text-lg text-foreground">{heading}</h2>
    {paragraphs.map((p, i) => (
      <p key={i} className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
        {p}
      </p>
    ))}
  </section>
);

export default SeoIntro;
