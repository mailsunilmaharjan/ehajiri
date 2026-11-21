import { useEffect, useState } from 'react';
import { authFetch } from '../lib/api';

export function Pic({ src, ...rest }) {
  return !src ? null : String(src).startsWith('data:') ? <img src={src} alt="" {...rest} /> : <AuthImg src={src} {...rest} />;
}

/** <img> for an Accounts file (product photo, bank QR, logo …). A plain <img src> can't send the login token,
 *  so the picture is fetched with it and shown from a blob URL. `src` is a path under /api/accounts. */
export default function AuthImg({ src, alt = '', onError, ...rest }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let dead = false, made = '';
    setUrl('');
    if (!src) return undefined;
    authFetch(src).then(async (r) => {
      if (!r.ok) throw new Error('missing');
      const b = await r.blob();
      if (dead) return;
      made = URL.createObjectURL(b); setUrl(made);
    }).catch(() => { if (!dead) onError?.(); });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [src]);   // eslint-disable-line react-hooks/exhaustive-deps
  return url ? <img src={url} alt={alt} {...rest} /> : null;
}
