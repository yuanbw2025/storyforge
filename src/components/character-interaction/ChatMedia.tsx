import {useState, type ReactNode} from 'react'
import type {ChatImageView, ChatMediaView} from './useChatMedia'

export function ChatImage({image, className, fallback = null}: {image?: ChatImageView | null; className?: string; fallback?: ReactNode}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return image && failedUrl !== image.url ? <img src={image.url} alt={image.alt} className={className} loading="lazy" onError={() => setFailedUrl(image.url)} /> : fallback
}

export default function ChatMedia({media}: {media: ChatMediaView}) {
  if (!media.background && !media.portraits.length && !media.missing) return null
  return <details className="chat-media-details" data-testid="chat-media-details"><summary>查看画面</summary>
    <div className="chat-media-gallery" aria-label="当前人物与场景">
      {media.background && <ChatImage image={media.background} className="chat-scene-picture" />}
      <div className="chat-portraits">{media.portraits.map(person => <figure key={person.participantKey}>
        <ChatImage image={person} className="chat-portrait" /><figcaption>{person.name}</figcaption>
      </figure>)}</div>
      {media.missing > 0 && <p>部分图片暂不可用，仍可继续文字聊天。</p>}
    </div>
  </details>
}
