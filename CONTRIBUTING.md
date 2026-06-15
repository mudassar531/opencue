# Contributing to opencue

Thanks for considering a contribution. opencue is an open-source meeting copilot — see [`README.md`](README.md) for what it does and [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md) for the master plan.

## Quickstart

```bash
git clone https://github.com/mudassar531/opencue.git
cd opencue
npm install
npm run dev
```

You should see the main window and the always-on-top overlay within a few seconds.

If you want to run **local STT / TTS** through the Python sidecar:

```bash
python3 -m venv sidecar/.venv
source sidecar/.venv/bin/activate
pip install -r sidecar/requirements.txt
```

Then start the sidecar from the **Local models & sidecar** panel inside the app.

## Working loop

Every phase of opencue follows the same 4-step loop — please respect it for PRs:

1. **THINK** — restate the change, list the files you'll touch, and call out any architectural risk.
2. **CODE** — small, typed, focused changes. Keep modules small. No `TODO` stubs in shipped paths.
3. **VALIDATE** — all four gates must be green:
   ```bash
   npm run typecheck   # 0 errors
   npm run lint        # 0 errors, 0 warnings
   npm test            # all suites pass
   npm run build       # production build succeeds
   ```
4. **PUSH** — Conventional Commit message (`feat:` / `fix:` / `chore:` / `docs:` / `refactor:`), one logical commit per change.

## Conventions

- **TypeScript everywhere, strict mode.** No `any` without a written justification comment.
- **Process boundaries are sacred** — the renderer never imports `electron` or `node:*`. Cross-process talk goes through [`src/shared/ipc-contract.ts`](src/shared/ipc-contract.ts) (declare → handle in `src/main/ipc.ts` → expose in `src/preload/index.ts` → add to `OpencueBridge`). ESLint enforces this.
- **Provider-agnostic design.** STT, LLM, TTS each sit behind an interface; concrete providers live under `src/main/providers/{stt,llm,tts}/` and are wired through `src/main/providers/router.ts`.
- **Encrypt secrets.** API keys go through Electron `safeStorage` — never plaintext, never logged, never committed.
- **Per-OS native code stays behind adapters** (see the audio capture path for an example).

## Pull requests

- One coherent change per PR.
- Update [`README.md`](README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) when the change affects user-facing behavior or the architecture.
- Unit-test pure logic. UI / Electron integration is exercised manually.

## Packaging from source

```bash
npm run package         # current OS
npm run package:mac     # macOS dmg
npm run package:win     # Windows NSIS installer
npm run package:linux   # AppImage + .deb
```

Unsigned builds work fine for personal use and CI. See `electron-builder.yml` + `build/entitlements.mac.plist` for the production signing / notarization shape (gated on CI secrets — see `.github/workflows/release.yml`).

## Code of conduct

Be respectful. Don't ship features that encourage covert surveillance or that violate the consent of the call participants. opencue is intended as a personal assist surface; if a PR's *purpose* is to defeat employer / school / exam monitoring, it will be rejected.

## License

By contributing you agree your contributions are licensed under the MIT License — same as the rest of the project ([`LICENSE`](LICENSE)).
