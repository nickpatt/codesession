/**
 * Tabs for switching between files in the shared project. Updates live as files
 * are added (including by the AI agent). The active file is highlighted.
 */
export function FileTabs({
  files,
  active,
  onSelect,
}: {
  files: string[];
  active: string | null;
  onSelect: (path: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="file-tabs">
      {files.map((path) => (
        <button
          key={path}
          className={`file-tab${path === active ? " active" : ""}`}
          onClick={() => onSelect(path)}
          title={path}
        >
          {path}
        </button>
      ))}
    </div>
  );
}
