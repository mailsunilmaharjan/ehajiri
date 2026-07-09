import React from 'react';

const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😉','😎','🤩',
  '🥳','😇','🙂','🙃','😅','😜','🤔','😐','😴','🤤',
  '😢','😭','😡','😱','🥺','😬','🙄','😏','😌','🤗',
  '👍','👎','👏','🙌','🙏','👋','💪','🤝','✌️','🤞',
  '❤️','🧡','💛','💚','💙','💜','🖤','💔','💯','🔥',
  '🎉','🎂','🎁','⭐','✅','❌','⚠️','❓','❗','💬',
  '☕','🍕','🍔','🍎','🌸','🌧️','☀️','🌙','⚡','🕐',
];

const EmojiPicker = ({ onPick, onClose }) => (
  <div
    onClick={e => e.stopPropagation()}
    style={{
      position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
      width: 300, maxHeight: 220, overflowY: 'auto',
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,.15)', padding: 10, zIndex: 20,
      display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 2,
    }}>
    {EMOJIS.map((em, i) => (
      <button
        key={i}
        onClick={() => onPick(em)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 19, padding: 4, borderRadius: 6, lineHeight: 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
        {em}
      </button>
    ))}
  </div>
);

export default EmojiPicker;
