import { useState, type MouseEvent } from "react";
import { BookOpen, Download, Star } from "lucide-react";

interface CoverCardProps {
  title: string;
  imageUrl: string | null;
  unreadCount?: number;
  downloadedCount?: number;
  totalChapters?: number;
  userRating?: number | null;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function CoverCard({
  title,
  imageUrl,
  unreadCount,
  downloadedCount = 0,
  totalChapters,
  userRating,
  onClick,
  onContextMenu,
}: CoverCardProps) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
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

        {/* Top-left badges matching Android NovelCoverCard (unread + downloaded) */}
        <div className="absolute left-2 top-2 flex items-center gap-1">
          {typeof unreadCount === "number" && unreadCount > 0 && (
            <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-fg)] shadow-xs tabular-nums">
              {unreadCount}
            </span>
          )}
          {downloadedCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-md bg-black/72 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md tabular-nums">
              <Download className="h-2.5 w-2.5 text-[var(--accent)]" />
              {downloadedCount}
            </span>
          )}
        </div>

        {/* Top-right user rating or total chapters */}
        {typeof userRating === "number" ? (
          <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-black/72 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur-md tabular-nums">
            <Star className="h-2.5 w-2.5 fill-amber-300" />
            {userRating}
          </div>
        ) : typeof totalChapters === "number" &&
          totalChapters > 0 &&
          downloadedCount === 0 &&
          !unreadCount ? (
          <div className="absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-md tabular-nums">
            {totalChapters} ch
          </div>
        ) : null}
      </div>

      <span className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-[1.35] text-[var(--text-primary)]/90 transition-colors group-hover:text-[var(--text-primary)]">
        {title}
      </span>
    </button>
  );
}
