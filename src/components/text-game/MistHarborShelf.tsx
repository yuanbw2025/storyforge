import { Link } from 'react-router'
import '../../pages/mist-harbor.css'
export default function MistHarborShelf() {
  return (
    <Link to="/play/mist-harbor" className="mist-shelf" aria-label="体验内置作品：雾港，失潮钟声">
      <div>
        <small>STORYFORGE ORIGINALS · 无需 API</small>
        <h2>雾港：失潮钟声</h2>
        <p>潮汐迟到了十三分钟。提起旧铜灯，走进一座正在遗忘姓名的城。</p>
      </div>
      <span>选择玩法 →</span>
    </Link>
  )
}
