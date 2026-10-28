// Edit this file to change the landing page copy.

export const greeting = "Hi, I'm Max.";

// Each line is a list of plain strings and links.
export type Part = string | { text: string; href: string };

export const lines: Part[][] = [
  ["Software engineer, passionate about inference and performance."],
  ["Prev @ Machyna, Inc. Now writing GPU kernels and learning distributed inference."],
];

export const socials = [
  { text: "Github", href: "https://github.com/maxxfuu" },
  { text: "Linkedin", href: "https://www.linkedin.com/in/maxxfuu" },
  { text: "X", href: "https://x.com/maxxfuu" },
];
