import { useCallback, useEffect, useState } from 'react';

/**
 * First-run onboarding wizard.
 *
 * Walks the user through:
 *   1. Privacy & ethics overview.
 *   2. Permissions check (mic + screen recording on macOS).
 *   3. Choosing cloud or local mode (sets the right provider defaults).
 *   4. Optional first-model download / sidecar bootstrap link.
 *   5. Hotkey cheatsheet + 'launch overlay' confirmation.
 *
 * The wizard only renders when `onboarding.completed` is false. The user can
 * skip at any step — `complete()` is called when they click Done.
 */
export function OnboardingWizard({ onClose }: { onClose: () => void }): JSX.Element {
  const [step, setStep] = useState(0);
  const total = 4;

  const finish = useCallback(async () => {
    await window.opencue.onboarding.complete();
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Welcome to opencue</h2>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            step {step + 1} / {total}
          </span>
        </div>

        {step === 0 ? <PrivacyStep /> : null}
        {step === 1 ? <PermissionsStep /> : null}
        {step === 2 ? <ModeStep /> : null}
        {step === 3 ? <HotkeysStep /> : null}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void finish()}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
          >
            skip
          </button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              >
                back
              </button>
            ) : null}
            {step < total - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                className="rounded-md bg-cue-500/20 px-3 py-1.5 text-xs text-cue-100 hover:bg-cue-500/30"
              >
                next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void finish()}
                className="rounded-md bg-cue-500/30 px-3 py-1.5 text-xs text-cue-50 hover:bg-cue-500/40"
              >
                done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacyStep(): JSX.Element {
  return (
    <div className="space-y-3 text-sm text-slate-300">
      <p>
        opencue is a personal copilot. It listens to your meeting, transcribes
        it, and surfaces helpful notes in a small overlay.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-slate-400">
        <li>Local mode keeps audio fully on-device.</li>
        <li>Cloud mode talks only to the providers whose keys you paste.</li>
        <li>API keys are encrypted at rest via Electron safeStorage.</li>
        <li>
          Use opencue where it&apos;s permitted; respect call participants and
          your employer&apos;s rules.
        </li>
      </ul>
    </div>
  );
}

function PermissionsStep(): JSX.Element {
  return (
    <div className="space-y-3 text-sm text-slate-300">
      <p>opencue needs two OS permissions to capture meeting audio:</p>
      <ul className="list-disc space-y-1 pl-5 text-slate-400">
        <li>
          <strong>Microphone</strong> — granted the first time you start a
          mic capture.
        </li>
        <li>
          <strong>Screen &amp; system audio recording</strong> (macOS / Windows)
          — required to capture loopback audio from a screen or window. On macOS
          open <em>System Settings → Privacy &amp; Security → Screen Recording</em>{' '}
          and enable opencue.
        </li>
      </ul>
      <p className="text-xs text-slate-500">
        Permissions are requested lazily — opencue won&apos;t pop a prompt until
        you actually press Start in the Audio capture panel.
      </p>
    </div>
  );
}

function ModeStep(): JSX.Element {
  const [busy, setBusy] = useState<'cloud' | 'local' | null>(null);

  const pickCloud = useCallback(async () => {
    setBusy('cloud');
    // The defaults already point at OpenAI; this is just a reassuring no-op.
    setBusy(null);
  }, []);

  const pickLocal = useCallback(async () => {
    setBusy('local');
    await window.opencue.providers.updateSelection({
      stt: { id: 'local-sidecar', model: 'faster-whisper-base.en' },
      llm: { id: 'ollama', model: 'llama3.2', temperature: 0.4, maxOutputTokens: 256 },
      tts: {
        id: 'local-sidecar',
        model: 'piper-en_US-amy-medium',
        voice: 'default',
        autoPlay: false,
      },
    });
    setBusy(null);
  }, []);

  return (
    <div className="space-y-3 text-sm text-slate-300">
      <p>Pick the mode you&apos;d like to start with:</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void pickCloud()}
          className="rounded-md border border-slate-700 bg-slate-950/40 p-3 text-left text-xs text-slate-200 hover:border-cue-400/60 hover:bg-cue-500/10 disabled:opacity-50"
        >
          <div className="font-medium text-slate-100">Cloud (recommended)</div>
          <p className="mt-1 text-slate-400">
            Bring your own keys (OpenAI / Anthropic / Deepgram / …). Fastest to set up,
            best quality.
          </p>
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void pickLocal()}
          className="rounded-md border border-slate-700 bg-slate-950/40 p-3 text-left text-xs text-slate-200 hover:border-cue-400/60 hover:bg-cue-500/10 disabled:opacity-50"
        >
          <div className="font-medium text-slate-100">Local (offline)</div>
          <p className="mt-1 text-slate-400">
            Python sidecar + Ollama. Download a faster-whisper / Piper model and run
            fully offline.
          </p>
        </button>
      </div>
      <p className="text-xs text-slate-500">
        You can change this any time in the Providers panel.
      </p>
    </div>
  );
}

function HotkeysStep(): JSX.Element {
  const rows: Array<[string, string]> = [
    ['Toggle overlay', '⌘/Ctrl + Shift + \\'],
    ['Move overlay', '⌘/Ctrl + Shift + M'],
    ['Assist', '⌘/Ctrl + Shift + Enter'],
    ['Recap', '⌘/Ctrl + Shift + R'],
    ['Ask bar', '⌘/Ctrl + Shift + /'],
    ['Click-through', '⌘/Ctrl + Shift + L'],
  ];
  return (
    <div className="space-y-3 text-sm text-slate-300">
      <p>Six global hotkeys are registered by default:</p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {rows.map(([label, accel]) => (
          <li
            key={accel}
            className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-xs"
          >
            <span className="text-slate-300">{label}</span>
            <kbd className="font-mono text-[10px] text-cue-300">{accel}</kbd>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Try <kbd className="font-mono text-cue-300">⌘/Ctrl + Shift + \\</kbd> now to summon the overlay.
      </p>
    </div>
  );
}

/** Top-level controller hook — renders the wizard only when not completed. */
export function useOnboarding(): { active: boolean; close: () => void } {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.opencue.onboarding.get().then((state) => {
      if (!cancelled) setActive(!state.completed);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    active,
    close: () => setActive(false),
  };
}
