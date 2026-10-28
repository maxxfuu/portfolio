import { Fragment } from "react";
import { greeting, lines, socials, type Part } from "@/content";

function Line({ parts }: { parts: Part[] }) {
  return (
    <p>
      <span className="hl">
        {parts.map((p, i) =>
          typeof p === "string" ? (
            <Fragment key={i}>{p}</Fragment>
          ) : (
            <a key={i} href={p.href} target="_blank" rel="noreferrer">
              {p.text}
            </a>
          ),
        )}
      </span>
    </p>
  );
}

export default function Home() {
  return (
    <main className="hero">
      <div className="intro" data-sky-avoid>
        <p>
          <span className="hl">{greeting}</span>
        </p>
        {lines.map((parts, i) => (
          <Line key={i} parts={parts} />
        ))}
      </div>

      <nav className="socials" data-sky-avoid>
        <span className="hl">
          {socials.map((s, i) => (
            <Fragment key={s.text}>
              {i > 0 && <span className="sep"> / </span>}
              <a href={s.href} target="_blank" rel="noreferrer">
                {s.text}
              </a>
            </Fragment>
          ))}
        </span>
      </nav>

      <p className="hint">
        <span className="hl">click the sky to steer the birds</span>
      </p>
    </main>
  );
}
