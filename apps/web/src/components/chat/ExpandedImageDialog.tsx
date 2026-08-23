import { memo, useCallback, useEffect, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [imageOffset, setImageOffset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const index = (preview.index + imageOffset + preview.images.length) % preview.images.length;

  const navigateImage = useCallback((direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (preview.images.length <= 1) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateImage(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateImage(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateImage, onClose, preview.images.length]);

  const item = preview.images[index];
  const itemSrc = item?.src;
  useEffect(() => setZoom(1), [itemSrc]);
  if (!item) return null;

  const zoomIn = () => setZoom((current) => Math.min(4, current + 0.5));
  const zoomOut = () => setZoom((current) => Math.max(1, current - 0.5));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded image preview"
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label="Close image preview"
        onClick={onClose}
      />
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
          aria-label="Previous image"
          onClick={() => navigateImage(-1)}
        >
          <ChevronLeftIcon className="size-5" />
        </Button>
      )}
      <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute right-2 top-2"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <XIcon />
        </Button>
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1 rounded-lg bg-black/65 p-1 text-white shadow-sm">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={zoom <= 1}
            onClick={zoomOut}
            aria-label="Zoom out"
          >
            <ZoomOutIcon />
          </Button>
          <span className="min-w-10 text-center text-[11px] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={zoom >= 4}
            onClick={zoomIn}
            aria-label="Zoom in"
          >
            <ZoomInIcon />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={zoom === 1}
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
          >
            <RotateCcwIcon />
          </Button>
        </div>
        <div className="max-h-[86vh] max-w-[92vw] overflow-auto rounded-lg border border-border/70 bg-background shadow-2xl">
          <img
            src={item.src}
            alt={item.name}
            className="block select-none object-contain"
            draggable={false}
            onDoubleClick={() => setZoom((current) => (current === 1 ? 2 : 1))}
            style={{
              width: zoom === 1 ? "auto" : `${zoom * 100}%`,
              maxWidth: zoom === 1 ? "92vw" : "none",
              maxHeight: zoom === 1 ? "86vh" : "none",
            }}
          />
        </div>
        <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
          {item.name}
          {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
        </p>
      </div>
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
          aria-label="Next image"
          onClick={() => navigateImage(1)}
        >
          <ChevronRightIcon className="size-5" />
        </Button>
      )}
    </div>
  );
});
