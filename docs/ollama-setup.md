# Local LLM Setup (Ollama)

Run resume tailoring fully offline — no Gemini API key needed, no 503 errors.

**Requirements:** NVIDIA GPU with 8 GB+ VRAM (e.g. RTX 3080, 4070, 5070)

---

## 1. Install Ollama

Download and run the installer from https://ollama.com/download

After installation, verify it's running:

```bash
ollama --version
```

---

## 2. Download a model

**Recommended for 12 GB VRAM (e.g. RTX 5070):**

```bash
ollama pull gemma3:27b
```

| Model | VRAM needed | Quality |
|---|---|---|
| `gemma3:12b` | ~8 GB | Good |
| `gemma3:27b` | ~18 GB | Best for resume writing |
| `qwen2.5:14b` | ~10 GB | Good alternative |

> `gemma3:27b` requires 18 GB VRAM. If your GPU has 12 GB, use `gemma3:12b` instead.

---

## 3. Configure the app

Edit `backend/.env`:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:12b
```

Comment out or leave `GEMINI_API_KEY` — it won't be used.

---

## 4. Start Ollama before running the app

Ollama runs as a background service after installation. If it's not running:

```bash
ollama serve
```

Then start the app as usual:

```bash
npm run dev
```

---

## Switching back to Gemini

Change one line in `backend/.env`:

```env
LLM_PROVIDER=gemini
```

---

## Troubleshooting

**"connection refused" error**
→ Ollama isn't running. Run `ollama serve` in a terminal.

**Response is very slow**
→ Model may be running on CPU. Check that your GPU drivers are up to date and CUDA is available.

**JSON parse error**
→ The model returned malformed JSON. Try a larger model (`gemma3:27b`) — smaller models occasionally fail to follow the JSON format instruction.
