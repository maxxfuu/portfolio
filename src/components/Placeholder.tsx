/** A page that hasn't been written yet, laid out like the home page's intro. */
export default function Placeholder({ title }: { title: string }) {
  return (
    <main className="hero">
      <div className="intro" data-sky-avoid>
        <p>
          <span className="hl">{title}</span>
        </p>
        <p className="muted">
          <span className="hl">Coming soon.</span>
        </p>
      </div>
    </main>
  );
}
