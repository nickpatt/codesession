import { useEffect, useRef } from "react";
import type { OutputLine } from "../exec/useExecution.js";

/**
 * The shared output panel. Renders streamed program output, auto-scrolling to
 * the bottom as new output arrives. stderr and system lines are color-coded.
 * Every participant sees the same content because the server fans it to all.
 */
export function OutputPanel({ output }: { output: OutputLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest output in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [output]);

  return (
    <div className="output">
      <div className="output-body">
        {output.length === 0 ? (
          <span className="output-empty">Output will appear here when you Run.</span>
        ) : (
          output.map((line, i) => (
            <span key={i} className={`out-${line.stream}`}>
              {line.text}
            </span>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
