import React, { useState, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import TranscriptPane from './TranscriptPane';

// Below this the panel is too narrow for two columns and falls back to tabs.
const SPLIT_MIN_WIDTH = 860;

const MODES = [
  { id: 'assist', label: 'Assist', description: 'Contextual screen & conversation assist' },
  { id: 'reply', label: 'Draft Reply', description: 'Suggest spoken reply based on dialogue' },
  { id: 'summarize', label: 'Summarize', description: 'Recap discussions' },
  { id: 'questions', label: 'Questions', description: 'Propose follow-up questions' }
];

export default function PanelBody({ messages, activeMode, onSelectMode, isListening, turns, onCopy }) {
  const [tab, setTab] = useState('answers');
  const [wide, setWide] = useState(() => window.innerWidth >= SPLIT_MIN_WIDTH);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= SPLIT_MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const answers = (
    <div className="messages-viewport">
      {messages.length === 0 ? (
        <div className="empty-viewport-state">
          <p className="primary-empty-text">Sidecar Assistant Active</p>
          <p className="secondary-empty-text">
            {isListening
              ? 'Listening to system audio and microphone stream...'
              : 'Toggle the status dot above to begin transcription capture.'}
          </p>
        </div>
      ) : (
        messages.map((msg, idx) => <MessageBubble key={idx} message={msg} />)
      )}
    </div>
  );

  const transcript = <TranscriptPane turns={turns} onCopy={onCopy} />;

  return (
    <div className="panel-body-container no-drag">
      {wide ? (
        <div className="split-view">
          <div className="split-col">{answers}</div>
          <div className="split-col split-col-transcript">{transcript}</div>
        </div>
      ) : (
        <>
          <div className="panel-tabs">
            <button
              className={`panel-tab-btn ${tab === 'answers' ? 'active' : ''}`}
              onClick={() => setTab('answers')}
            >
              Answers
            </button>
            <button
              className={`panel-tab-btn ${tab === 'transcript' ? 'active' : ''}`}
              onClick={() => setTab('transcript')}
            >
              Transcript{turns.length > 0 ? ` · ${turns.length}` : ''}
            </button>
          </div>
          {tab === 'answers' ? answers : transcript}
        </>
      )}

      <div className="quick-actions-row">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            className={`action-pill-btn ${activeMode === mode.id ? 'active' : ''}`}
            onClick={() => onSelectMode(mode.id)}
            title={mode.description}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
