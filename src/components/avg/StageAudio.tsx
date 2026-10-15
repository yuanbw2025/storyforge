import { useEffect, useRef } from "react";
export default function StageAudio({
  src,
  volume,
  loop,
  channel,
  paused = false,
}: {
  src: string;
  volume: number;
  loop: boolean;
  channel: string;
  paused?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume, src]);
  useEffect(() => {
    const audio = ref.current
    if (!audio) return
    if (paused) audio.pause(); else void audio.play().catch(() => undefined)
    return () => audio.pause()
  }, [src, paused]);
  return (
    <audio
      ref={ref}
      src={src}
      loop={loop}
      data-channel={channel}
      onLoadedMetadata={() => {
        if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
      }}
    />
  );
}
