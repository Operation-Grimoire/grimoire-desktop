import { useState } from "react";
import { BookOpen, Download } from "lucide-react";

interface CoverCardProps {
  title: string;
  imageUrl: string | null;
  downloadedCount?: number;
  totalChapters?: number;
  onClick: () => void;
}

export function CoverCard({
  title,
  imageUrl,
  downloadedCount = 0,
  totalChapters,
  onClick,
}: CoverCardProps) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col text-left focus:outline-none"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-sm transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:border-[var(--border-strong)] group-active:scale-[0.985]">
        {imageUrl && !failed ? (
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-elevated)] text-[var(--text-muted)]">
            <BookOpen className="h-8 w-8 stroke-[1.35] opacity-40" />
          </div>
        )}

        {/* Top-left subtle offline badge */}
        {downloadedCount > 0 && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
            <Download className="h-2.5 w-2.5 text-[var(--accent)]" />
            <span className="tabular-nums">{downloadedCount}</span>
          </div>
        )}

        {typeof totalChapters === "number" && totalChapters > 0 && downloadedCount === 0 && (
          <div className="absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-md tabular-nums">
            {totalChapters} ch
          </div>
        )}
      </div>

      <span className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-[1.35] text-[var(--text-primary)]/90 transition-colors group-hover:text-[var(--text-primary)]">
        {title}
      </span>
    </button>
  );
}
