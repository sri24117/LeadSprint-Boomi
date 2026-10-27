import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Ear,
  Headphones,
  Mic,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Radio,
  User,
  Volume2,
} from 'lucide-react';
import { Badge, Button, PageHeader, Section } from '@/components/common';

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
      <PageHeader
        eyebrow="Console"
        title="Live calls"
        description="Real-time audio telemetry, live conversational speech turns, and human operator takeover controls."
      />

      {!callEnded ? (
        <div className="grid gap-5 lg:grid-cols-12">
          {/* Active call main card */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 lg:col-span-7">
            <div className="flex flex-col justify-between gap-4 border-b border-[hsl(var(--border))] pb-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))]">
                  <PhoneCall size={20} className="animate-pulse-dot" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-[hsl(var(--foreground))]">Rohan Mehta</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] text-[hsl(var(--success))]`}>
                      Live
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
                    +1 646 555 0130 · Park Slope, NY
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Duration
                  </span>
                  <p className="font-mono text-sm font-bold text-[hsl(var(--primary))]">
                    {formatTimer(seconds)}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold flex items-center gap-1.5 border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] text-[hsl(var(--success))]`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))] animate-pulse-dot" />
                  Live audio
                </span>
              </div>
            </div>

            {/* Live audio visualizer */}
            <div className="my-5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
              <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] mb-3">
                <span className="flex items-center gap-1.5 font-medium">
                  <Volume2 size={14} className="text-[hsl(var(--muted-foreground))]" />
                  Sara (AI agent) speaking with lead
                </span>
                <span className="font-mono text-[hsl(var(--success))]">Latency: 260ms</span>
              </div>
              <div className="flex h-10 items-center justify-center gap-1.5">
                {[28, 48, 72, 95, 60, 85, 40, 90, 100, 65, 45, 80, 55, 30, 88, 70, 95, 40, 25, 65, 80, 50].map(
                  (height, i) => (
                    <div
                      key={i}
                      className="w-1.5 rounded-full bg-[hsl(var(--primary))] transition-all duration-300 animate-pulse-dot"
                      style={{
                        height: `${height}%`,
                        animationDelay: `${i * 60}ms`,
                      }}
                    />
                  ),
                )}
              </div>
            </div>

            {/* Operator actions */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2">
              <button
                onClick={() => setIsListening(!isListening)}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-md border p-3 text-xs font-semibold transition ${
                  isListening
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))/0.08] text-[hsl(var(--primary))]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                }`}
                data-testid="button-listen-in"
              >
                <Ear size={18} />
                <span>{isListening ? 'Mute audio' : 'Listen in'}</span>
              </button>

              <button
                className="flex flex-col items-center justify-center gap-1.5 rounded-md border p-3 text-xs font-semibold border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                data-testid="button-whisper"
              >
                <Mic size={18} />
                <span>Whisper to AI</span>
              </button>

              <button
                onClick={handleTransfer}
                disabled={transferred}
                className="flex flex-col items-center justify-center gap-1.5 rounded-md border p-3 text-xs font-semibold transition border-[hsl(var(--primary))] bg-[hsl(var(--primary))/0.08] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/0.12] disabled:opacity-40 disabled:pointer-events-none"
                data-testid="button-transfer-call"
              >
                <PhoneForwarded size={18} />
                <span>{transferred ? 'Transferred!' : 'Take over call'}</span>
              </button>

              <button
                onClick={handleEndCall}
                className="flex flex-col items-center justify-center gap-1.5 rounded-md border p-3 text-xs font-semibold transition border-[hsl(var(--destructive))/0.35] bg-[hsl(var(--destructive))/0.05] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))/0.12]"
                data-testid="button-end-call"
              >
                <PhoneOff size={18} />
                <span>End call</span>
              </button>
            </div>
          </div>

          {/* Right column: live transcript stream */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 lg:col-span-5">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Live speech stream
              </h3>
              <span className="flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--success))]">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))] animate-ping" />
                Streaming
              </span>
            </div>

            <div className="mt-4 space-y-4 max-h-[440px] overflow-y-auto pr-1">
              <div className="rounded-lg border border-[hsl(var(--primary))/0.25] bg-[hsl(var(--primary))/0.06] p-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[hsl(var(--primary))] mb-1">
                  <span>Sara (AI assistant)</span>
                  <span className="text-[hsl(var(--muted-foreground))]">00:04</span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                  "Hi Rohan! This is Sara with Northstar Realty. I saw you submitted an enquiry regarding the 3-bedroom townhome on 7th Avenue in Park Slope. Are you still looking to relocate this winter?"
                </p>
              </div>

              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[hsl(var(--foreground))] mb-1">
                  <span>Rohan Mehta (lead)</span>
                  <span className="text-[hsl(var(--muted-foreground))]">00:18</span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                  "Yes, hello! We definitely are. Our lease ends in March so we are hoping to lock down a home between $1.2M and $1.5M with outdoor space."
                </p>
              </div>

              <div className="rounded-lg border border-[hsl(var(--primary))/0.25] bg-[hsl(var(--primary))/0.06] p-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[hsl(var(--primary))] mb-1">
                  <span>Sara (AI assistant)</span>
                  <span className="text-[hsl(var(--muted-foreground))]">00:45</span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                  "That property actually features a private 400 square-foot landscaped garden! Would you have 30 minutes this weekend for an exclusive showing?"
                </p>
              </div>

              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[hsl(var(--foreground))] mb-1">
                  <span>Rohan Mehta (lead)</span>
                  <span className="text-[hsl(var(--muted-foreground))]">01:12</span>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                  "Saturday at 2 PM would be ideal for me and my wife if that slot is available."
                </p>
              </div>

              {transferred && (
                <div className="rounded-lg border border-[#f7e08a]/0.5 bg-[#fffbeb]/0.6 p-3 text-[#854d0e] text-xs">
                  <p className="font-semibold">Operator handed off</p>
                  <p className="mt-0.5 text-[11px]">
                    Sara: "I am connecting you with Maya Patel, our senior property specialist, right now."
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Section title="Call completed &amp; transcribed">
          <div className="flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[hsl(var(--success))/0.10] text-[hsl(var(--success))]">
              <AlertCircle size={28} />
            </div>
          </div>
          <h3 className="mt-4 text-base font-bold text-center text-[hsl(var(--foreground))]">Call completed &amp; transcribed</h3>
          <p className="mt-1 text-sm text-center text-[hsl(var(--muted-foreground))] max-w-md mx-auto">
            The conversation was saved to Call History. An appointment confirmation link was dispatched via Cal.com.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => {
                setCallEnded(false);
                setSeconds(0);
                setTransferred(false);
              }}
              className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90]"
            >
              Simulate another inbound call
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
