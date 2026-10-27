import { useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
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
import { Button, Input, PageHeader, Section, SectionBody, Select, TextArea } from '@/components/common';

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
      <PageHeader
        eyebrow="Console / AI agents"
        title="Agent builder"
        description="Design conversational prompts, voices, LLM parameters, and tool integrations."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={playVoiceSample}
              className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
              data-testid="button-voice-sample"
            >
              <Volume2 size={15} className={isPlayingVoice ? 'text-[hsl(var(--primary))] animate-pulse-dot' : 'text-[hsl(var(--muted-foreground))]'}/>
              <span>{isPlayingVoice ? 'Speaking…' : 'Test voice audio'}</span>
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90]"
              data-testid="button-save-agent"
            >
              {isSaved ? <CheckCircle2 size={15} /> : <Save size={15} />}
              <span>{isSaved ? 'Deployed to Retell' : 'Save &amp; deploy'}</span>
            </button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Left Column: Configuration Forms */}
        <div className="space-y-5 lg:col-span-7">
          <Section
            title="Voice &amp; acoustic model"
            description="Choose the voice persona, synthesis engine, and speaking parameters."
          >
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Voice persona</label>
                <Select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full"
                >
                  <option value="Aura-Asteria">Aura-Asteria (warm &amp; engaging)</option>
                  <option value="Aura-Orion">Aura-Orion (calm &amp; professional)</option>
                  <option value="Rachel-ElevenLabs">Rachel (ElevenLabs Turbo v2)</option>
                  <option value="Nova-OpenAI">Nova (OpenAI Realtime)</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Voice synthesis engine</label>
                <Select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full"
                >
                  <option value="Deepgram">Deepgram (ultra-low latency, &lt;300ms)</option>
                  <option value="ElevenLabs">ElevenLabs (high expressive nuance)</option>
                  <option value="Cartesia">Cartesia Sonic (fast conversational)</option>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <div className="flex justify-between text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-1">
                  <span>Speech rate</span>
                  <span className="font-mono text-[hsl(var(--primary))]">{speed}x</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  className="w-full cursor-pointer"
                  style={{ accentColor: 'hsl(var(--primary))' }}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <div className="flex justify-between text-xs font-semibold text-[hsl(var(--muted-foreground))] mb-1">
                  <span>Creativity &amp; temperature</span>
                  <span className="font-mono text-[hsl(var(--primary))]">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="w-full cursor-pointer"
                  style={{ accentColor: 'hsl(var(--primary))' }}
                />
              </div>
            </div>
          </Section>

          <Section title="First spoken greeting" description="Triggered immediately upon phone pickup.">
            <TextArea
              rows={3}
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              className="mt-2 w-full"
              placeholder="What should the agent say the moment the lead answers?"
              data-testid="textarea-first-message"
            />
          </Section>

          <Section title="System prompt &amp; qualification logic" description="Define the conversation goals, qualification questions, handling for price objections, and safety transfer rules.">
            <div className="flex items-end gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))] mt-2">
              <span className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] px-2 py-0.5 text-[hsl(var(--muted-foreground))]">GPT-4o Realtime</span>
            </div>
            <TextArea
              rows={12}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-2 w-full font-mono text-xs leading-relaxed"
              data-testid="textarea-system-prompt"
            />
          </Section>
        </div>

        {/* Right Column: Live Testing Simulator */}
        <div className="space-y-5 lg:col-span-5">
          <div className="sticky top-[90px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))]">
                  <Bot size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[hsl(var(--foreground))]">Interactive conversation sandbox</h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--success))]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))] animate-pulse-dot" />
                    <span>Acoustic latency: ~280ms</span>
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
                title="Reset conversation"
                className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            <div className="h-[420px] overflow-y-auto p-4 space-y-3.5 bg-[hsl(var(--muted))/0.3]">
              {testMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
                      {msg.role === 'agent' ? 'Sara (AI voice)' : 'You (lead)'}
                    </span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">· {msg.time}</span>
                  </div>
                  <div
                    className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed ${
                      msg.role === 'agent'
                        ? 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]'
                        : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-[hsl(var(--border))] p-3 bg-[hsl(var(--card))]">
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
                  placeholder="Type a response to test Sara…"
                  className="flex-1 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3.5 py-2 text-xs text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                />
                <button
                  type="submit"
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90]"
                >
                  <Send size={13} />
                </button>
              </form>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))] px-1">
                <span>Press enter to send</span>
                <span className="flex items-center gap-1 text-[hsl(var(--primary))] font-medium cursor-pointer hover:underline">
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
