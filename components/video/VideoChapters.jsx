'use client';

import { useState } from 'react';
import { MapPin, ChevronDown } from 'lucide-react';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export default function VideoChapters({ chapters, activeChapter, onSeek, className = '' }) {
  // Default closed — chapter strip is a navigation aid the user opens when
  // they want it, not something that takes up vertical real estate by default.
  const [open, setOpen] = useState(false);

  if (!chapters || chapters.length < 2) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 mb-2 w-full text-left group focus:outline-none"
        aria-expanded={open}
      >
        <MapPin className="w-3.5 h-3.5 text-gray-500" />
        <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide group-hover:text-gray-900">
          Chapters
        </h4>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5 pb-1.5 -mx-1 px-1">
          {chapters.map((chapter, idx) => {
            const isActive = activeChapter === chapter;
            return (
              <button
                key={`${chapter.startTime}-${chapter.room}-${idx}`}
                onClick={() => onSeek(chapter.startTime)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-200 text-blue-900 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
                title={`Jump to ${chapter.room} at ${formatTime(chapter.startTime)}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[10px] tabular-nums ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>
                    {formatTime(chapter.startTime)}
                  </span>
                  <span className="font-medium whitespace-nowrap">{chapter.room}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
