export function NotebookCover({
  title,
  index = 0,
  skeleton = false,
}: {
  title: string;
  index?: number;
  skeleton?: boolean;
}) {
  const length = title.replace(/\s/g, '').length;
  return (
    <div className={`notebook-cover notebook-tone-${index % 5}`}>
      <div className="notebook-sheet" aria-hidden="true" />
      <div className="notebook-front">
        <span className="notebook-binding" aria-hidden="true" />
        {skeleton ? (
          <div className="notebook-skeleton" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <h2
            title={title}
            style={{
              fontSize: length > 35 ? `${Math.min(9.5, Math.sqrt(3200 / length))}cqw` : undefined,
            }}
          >
            {title}
          </h2>
        )}
        <span className="notebook-rule" aria-hidden="true" />
      </div>
    </div>
  );
}
