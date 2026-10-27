import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Ear,
  Headphones,
  Mic,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Radio,
  Sparkles,
  User,
  Volume2,
} from 'lucide-react';
import { Badge, Button } from '@/components/common';

export default function LiveCallsPage() {
  const [seconds, setSeconds] = useState(165); // 2m 45s
  const [transferred, setTransferred] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Live timer tick
  useEffect(() => {
    if (callEnded) return;
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [callEnded]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTransfer = () => {
    setTransferred(true);
  };

  const handleEndCall = () => {
    setCallEnded(true);
  };

  return (
    <div className="animate-rise-in space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/80 via-white to-indigo-50/60 p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            <h2 className="text-base font-bold text-slate-800">Live Telephony Supervision</h2>
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
              1 Active Call
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Real-time audio telemetry, live conversational speech turns, and human operator takeover controls.
          </p>
        </div>
      </div>

      {!callEnded ? (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Active Call Main Card */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-7">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                  <PhoneCall size={22} className="animate-bounce" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Rohan Mehta</h3>
                  <p className="text-xs text-slate-500 font-mono">+1 646 555 0130 · Park Slope, NY</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Duration</span>
                  <p className="font-mono text-xl font-bold text-violet-600">{formatTimer(seconds)}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Audio
                </span>
              </div>
            </div>

            {/* Live Audio Visualizer Animation */}
            <div className="my-5 rounded-xl bg-slate-900 p-4 text-white">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
                <span className="flex items-center gap-1.5 font-medium">
                  <Volume2 size={14} className="text-violet-400" />
                  Sara (AI Agent) speaking with Lead
                </span>
                <span className="font-mono text-emerald-400">Latency: 260ms</span>
              </div>
              <div className="flex h-12 items-center justify-center gap-1.5">
                {[28, 48, 72, 95, 60, 85, 40, 90, 100, 65, 45, 80, 55, 30, 88, 70, 95, 40, 25, 65, 80, 50].map(
                  (height, i) => (
                    <div
                      key={i}
                      className="w-1.5 rounded-full bg-gradient-to-t from-violet-500 to-indigo-400 transition-all duration-300 animate-pulse"
                      style={{
                        height: `${height}%`,
                        animationDelay: `${i * 60}ms`,
                      }}
                    />
                  ),
                )}
              </div>
            </div>

            {/* Operator Actions */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2">
              <button
                onClick={() => setIsListening(!isListening)}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition ${
                  isListening
                    ? 'border-violet-500 bg-violet-50 text-violet-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                data-testid="button-listen-in"
              >
                <Ear size={18} />
                <span>{isListening ? 'Mute Audio' : 'Listen In'}</span>
              </button>

              <button
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                data-testid="button-whisper"
              >
                <Mic size={18} />
                <span>Whisper to AI</span>
              </button>

              <button
                onClick={handleTransfer}
                disabled={transferred}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
                data-testid="button-transfer-call"
              >
                <PhoneForwarded size={18} />
                <span>{transferred ? 'Transferred!' : 'Take Over Call'}</span>
              </button>

              <button
                onClick={handleEndCall}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                data-testid="button-end-call"
              >
                <PhoneOff size={18} />
                <span>End Call</span>
              </button>
            </div>
          </div>

          {/* Right Column: Live Transcript Stream */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Live Speech Stream
              </h3>
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                Streaming
              </span>
            </div>

            <div className="mt-4 space-y-4 max-h-[440px] overflow-y-auto pr-1">
              <div className="rounded-xl bg-violet-50/70 p-3 border border-violet-100">
                <div className="flex items-center justify-between text-[11px] font-semibold text-violet-800 mb-1">
                  <span>Sara (AI Assistant)</span>
                  <span className="text-slate-400">00:04</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  "Hi Rohan! This is Sara with Northstar Realty. I saw you submitted an enquiry regarding the 3-bedroom townhome on 7th Avenue in Park Slope. Are you still looking to relocate this winter?"
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200/70">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-800 mb-1">
                  <span>Rohan Mehta (Lead)</span>
                  <span className="text-slate-400">00:18</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  "Yes, hello! We definitely are. Our lease ends in March so we are hoping to lock down a home between $1.2M and $1.5M with outdoor space."
                </p>
              </div>

              <div className="rounded-xl bg-violet-50/70 p-3 border border-violet-100">
                <div className="flex items-center justify-between text-[11px] font-semibold text-violet-800 mb-1">
                  <span>Sara (AI Assistant)</span>
                  <span className="text-slate-400">00:45</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  "That property actually features a private 400 square-foot landscaped garden! Would you have 30 minutes this weekend for an exclusive showing?"
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200/70">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-800 mb-1">
                  <span>Rohan Mehta (Lead)</span>
                  <span className="text-slate-400">01:12</span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  "Saturday at 2 PM would be ideal for me and my wife if that slot is available."
                </p>
              </div>

              {transferred && (
                <div className="rounded-xl bg-amber-50 p-3 border border-amber-200 text-amber-800 text-xs">
                  <p className="font-semibold">Operator Handed Off</p>
                  <p className="mt-0.5 text-[11px]">
                    Sara: "I am connecting you with Maya Patel, our senior property specialist, right now."
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-12 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={28} />
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-800">Call Completed & Transcribed</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
            The conversation was saved to Call History. An appointment confirmation link was dispatched via Cal.com.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => {
                setCallEnded(false);
                setSeconds(0);
                setTransferred(false);
              }}
              className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-violet-700"
            >
              Simulate Another Inbound Call
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
