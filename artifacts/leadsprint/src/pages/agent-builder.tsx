import { useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Headphones,
  Mic,
  Play,
  RotateCcw,
  Save,
  Send,
  Sliders,
  Sparkles,
  Volume2,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/common';

export default function AgentBuilderPage() {
  const [name, setName] = useState('sara');
  const [voice, setVoice] = useState('Aura-Asteria');
  const [provider, setProvider] = useState('Deepgram');
  const [speed, setSpeed] = useState('1.0');
  const [temperature, setTemperature] = useState('0.7');
  const [firstMessage, setFirstMessage] = useState(
    'Hi, this is Sara calling from Northstar Realty. I saw you requested details on our 2-bedroom condos in Williamsburg. Do you have a moment to chat about what you are looking for?',
  );
  const [prompt, setPrompt] = useState(
    `You are Sara, a friendly and professional real estate sales assistant for Northstar Realty.
Your objective is to qualify incoming buyer enquiries and confirm their interest in booking an in-person showing.

QUALIFICATION RULES:
1. Target location and preferred neighborhoods (e.g., Williamsburg, Park Slope, DUMBO).
2. Budget range and financing readiness (pre-approved mortgage or cash).
3. Move-in timeline (0-3 months, 3-6 months, or 12+ months).
4. If qualified and timeline is within 3 months, offer to schedule an agent showing via Cal.com.

SAFETY RULES:
- Never provide legal, mortgage interest rates, or fair housing advice.
- If asked complex questions outside approved property facts, transfer to human operator.`,
  );

  // Live Simulator state
  const [testMessages, setTestMessages] = useState<Array<{ role: 'agent' | 'user'; text: string; time: string }>>([
    {
      role: 'agent',
      text: 'Hi, this is Sara calling from Northstar Realty. I saw you requested details on our 2-bedroom condos in Williamsburg. Do you have a moment to chat about what you are looking for?',
      time: '10:14 AM',
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    const userText = inputMessage.trim();
    setInputMessage('');

    setTestMessages((prev) => [
      ...prev,
      { role: 'user', text: userText, time: 'Just now' },
    ]);

    // Simulated AI response
    setTimeout(() => {
      let aiResponse = "That sounds wonderful! We have two brand new units in that exact budget. Would you be free this Saturday afternoon around 2 PM to walk through?";
      if (userText.toLowerCase().includes('budget') || userText.toLowerCase().includes('price')) {
        aiResponse = "Units in this development start from $850,000 up to $1.2M depending on the floor and view. Does that align with what you had in mind?";
      } else if (userText.toLowerCase().includes('not interested') || userText.toLowerCase().includes('stop')) {
        aiResponse = "Understood completely! I'll make a note of that and won't reach out again. Thank you and have a great day!";
      }

      setTestMessages((prev) => [
        ...prev,
        { role: 'agent', text: aiResponse, time: 'Just now' },
      ]);
    }, 900);
  };

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const playVoiceSample = () => {
    setIsPlayingVoice(true);
    setTimeout(() => setIsPlayingVoice(false), 2000);
  };

  return (
    <div className="animate-rise-in space-y-6">
      {/* Header bar */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Link
            href="/workspace/agents"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs transition hover:bg-slate-50"
            data-testid="link-back-agents"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">Agent Studio: {name}</h1>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                Live on Retell
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Configure system prompt, telephony parameters, and test conversation logic.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={playVoiceSample}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50"
            data-testid="button-voice-sample"
          >
            <Volume2 size={15} className={isPlayingVoice ? 'text-violet-600 animate-pulse' : 'text-slate-500'} />
            <span>{isPlayingVoice ? 'Speaking…' : 'Test Voice Audio'}</span>
          </button>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-violet-700 active:scale-95"
            data-testid="button-save-agent"
          >
            {isSaved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            <span>{isSaved ? 'Deployed to Retell' : 'Save & Deploy'}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Configuration Forms */}
        <div className="space-y-6 lg:col-span-7">
          {/* Voice & Personality Card */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Sliders size={16} className="text-violet-600" />
              <span>Voice & Acoustic Model</span>
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-700">Voice Persona</label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  <option value="Aura-Asteria">Aura-Asteria (Warm & Engaging)</option>
                  <option value="Aura-Orion">Aura-Orion (Calm & Professional)</option>
                  <option value="Rachel-ElevenLabs">Rachel (ElevenLabs Turbo v2)</option>
                  <option value="Nova-OpenAI">Nova (OpenAI Realtime)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Voice Synthesis Engine</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  <option value="Deepgram">Deepgram (Ultra-low latency, &lt;300ms)</option>
                  <option value="ElevenLabs">ElevenLabs (High expressive nuance)</option>
                  <option value="Cartesia">Cartesia Sonic (Fast conversational)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>Speech Rate</span>
                  <span className="font-mono text-violet-600">{speed}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  className="mt-2 w-full accent-violet-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>Creativity & Temperature</span>
                  <span className="font-mono text-violet-600">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="mt-2 w-full accent-violet-600"
                />
              </div>
            </div>
          </div>

          {/* First Message Card */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Volume2 size={16} className="text-violet-600" />
                <span>First Spoken Greeting</span>
              </h2>
              <span className="text-[11px] text-slate-400">Triggered immediately upon phone pickup</span>
            </div>
            <textarea
              rows={3}
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              className="mt-3 w-full rounded-xl border border-slate-200 p-3.5 text-sm text-slate-800 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              placeholder="What should the agent say the moment the lead answers?"
            />
          </div>

          {/* Prompt Instructions */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Sparkles size={16} className="text-violet-600" />
                <span>System Prompt & Qualification Logic</span>
              </h2>
              <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                GPT-4o Realtime
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Define the conversation goals, qualification questions, handling for price objections, and safety transfer rules.
            </p>
            <textarea
              rows={12}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-3 w-full font-mono text-xs leading-relaxed rounded-xl border border-slate-200 p-3.5 text-slate-800 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
        </div>

        {/* Right Column: Live Testing Simulator */}
        <div className="space-y-6 lg:col-span-5">
          <div className="sticky top-24 rounded-2xl border border-slate-200/90 bg-white shadow-xs">
            {/* Simulator Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <Bot size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-800">Interactive Conversation Sandbox</h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Acoustic Latency: ~280ms</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() =>
                  setTestMessages([
                    {
                      role: 'agent',
                      text: firstMessage,
                      time: 'Just now',
                    },
                  ])
                }
                title="Reset Conversation"
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="h-[430px] overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
              {testMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-semibold text-slate-500">
                      {msg.role === 'agent' ? 'Sara (AI Voice)' : 'You (Lead)'}
                    </span>
                    <span className="text-[10px] text-slate-400">· {msg.time}</span>
                  </div>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-2xs ${
                      msg.role === 'agent'
                        ? 'bg-white border border-slate-200/80 text-slate-800 rounded-tl-sm'
                        : 'bg-violet-600 text-white rounded-tr-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <div className="border-t border-slate-100 p-3 bg-white rounded-b-2xl">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Type a response to test Sara..."
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
                <button
                  type="submit"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs transition hover:bg-violet-700 active:scale-95"
                >
                  <Send size={13} />
                </button>
              </form>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 px-1">
                <span>Press Enter to send</span>
                <span className="flex items-center gap-1 text-violet-600 font-medium cursor-pointer hover:underline">
                  <Mic size={11} /> Speak with microphone
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
