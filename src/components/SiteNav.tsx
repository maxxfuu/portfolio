"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "home" },
  { href: "/projects", label: "projects" },
  { href: "/blogs", label: "blogs" },
  { href: "/resources", label: "resources" },
];

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Site">
      {LINKS.map((l, i) => (
        <span key={l.href}>
          {i > 0 && <span aria-hidden>/ </span>}
          <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
