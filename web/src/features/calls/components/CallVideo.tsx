import { useEffect, useRef } from "react";

import { cn } from "@/shared/utils/cn";

export function CallVideo({
  className,
  label,
  muted = false,
  stream,
}: {
  className?: string;
  label: string;
  muted?: boolean;
  stream: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={videoRef}
      aria-label={label}
      autoPlay
      className={cn("h-full w-full rounded-[var(--radius)] object-cover", className)}
      muted={muted}
      playsInline
    />
  );
}
