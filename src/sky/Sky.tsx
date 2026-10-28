"use client";

import { useEffect, useRef } from "react";
import { SkyEngine } from "./engine";

export default function Sky() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const sky = new SkyEngine(ref.current);
    sky.start();
    return () => sky.destroy();
  }, []);

  return <canvas ref={ref} aria-hidden className="fixed inset-0 h-full w-full" />;
}
