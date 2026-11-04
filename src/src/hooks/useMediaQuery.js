import { useEffect, useState } from 'react';

/**
 * Whether a media query matches now, kept current as the window changes.
 * False wherever `matchMedia` does not exist (jsdom, old browsers), so a
 * caller's default is always the phone's layout.
 */
export default function useMediaQuery(query) {
  const read = () => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? Boolean(window.matchMedia(query).matches)
        : false;
    } catch (_) {
      return false;
    }
  };
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    let list;
    try { list = window.matchMedia(query); } catch (_) { return undefined; }
    if (!list) return undefined;
    const onChange = () => setMatches(Boolean(list.matches));
    onChange();
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    if (typeof list.addListener === 'function') {
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    }
    return undefined;
  }, [query]);
  return matches;
}
