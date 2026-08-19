import React, { useState, useEffect, useRef, useMemo } from 'react';

function relativeTime(timestamp, now) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * The live transcript. Before Phase 2 every turn went to sidecar.log() and nowhere
 * the user could see.
 *
 * Interim turns (Phase 3) render greyed and italic and are replaced in place when the
 * final arrives.
 */
export default function TranscriptPane({ turns, onCopy }) {
  const [query, setQuery] = useState('');
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [now, setNow] = useState(Date.now());
  const viewportRef = useRef(null);
  const lastCount = useRef(turns.length);

  // Relative timestamps need a slow tick of their own.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const grew = turns.length > lastCount.current;
    lastCount.current = turns.length;
    if (!grew) return;

    if (stuckToBottom && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      setUnseen(0);
    } else {
      setUnseen((n) => n + 1);
    }
  }, [turns.length, stuckToBottom]);

  const handleScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStuckToBottom(atBottom);
    if (atBottom) setUnseen(0);
  };

  const jumpToLatest = () => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStuckToBottom(true);
    setUnseen(0);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return turns;
    return turns.filter((t) => t.text.toLowerCase().includes(needle));
  }, [turns, query]);

  const copyAll = () => {
    const text = turns
      .filter((t) => !t.interim)
      .map((t) => `${t.sender === 'user' ? 'You' : 'Them'}: ${t.text}`)
      .join('\n');
    onCopy(text);
  };

  return (
    <div className="transcript-pane">
      <div className="transcript-toolbar">
        <input
          type="text"
          className="transcript-search"
          placeholder="Search transcript…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <span className="transcript-count">{filtered.length}/{turns.length}</span>
        )}
        <button type="button" className="link-btn" onClick={copyAll} disabled={turns.length === 0}>
          Copy all
        </button>
      </div>

      <div className="transcript-viewport" ref={viewportRef} onScroll={handleScroll}>
        {turns.length === 0 ? (
          <div className="empty-viewport-state">
            <p className="primary-empty-text">Nothing transcribed yet</p>
            <p className="secondary-empty-text">
              Turn on capture and both sides of the conversation appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-viewport-state">
            <p className="secondary-empty-text">No turns match “{query}”.</p>
          </div>
        ) : (
          filtered.map((turn) => (
            <div
              key={turn.id}
              className={`turn-row ${turn.sender === 'user' ? 'is-you' : 'is-them'} ${turn.interim ? 'is-interim' : ''}`}
            >
              <div className="turn-head">
                <span className="turn-speaker">{turn.sender === 'user' ? 'You' : 'Them'}</span>
                <span className="turn-time">{relativeTime(turn.timestamp, now)}</span>
                <button
                  type="button"
                  className="turn-copy link-btn"
                  onClick={() => onCopy(turn.text)}
                  title="Copy this turn"
                >
                  Copy
                </button>
              </div>
              <p className="turn-text">{turn.text}</p>
            </div>
          ))
        )}
      </div>

      {unseen > 0 && !stuckToBottom && (
        <button type="button" className="jump-latest-pill" onClick={jumpToLatest}>
          {unseen} new · jump to latest
        </button>
      )}
    </div>
  );
}
