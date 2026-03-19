# TraceLens — PeopleCode Trace Analyzer

A web-based tool for analyzing large PeopleCode trace files (500MB to 1GB+) with AI-powered insights. Parses SQL performance, detects loop patterns, identifies errors, and provides actionable PeopleCode fix suggestions.

## What It Does

- **Streams** large trace files line-by-line without loading them into memory
- **Groups SQL** by normalized signature, flags slow queries and N+1 patterns
- **Detects loops** using a sliding window algorithm with fix suggestions
- **Parses events** into a hierarchical flame chart visualization
- **Scans errors** with 3-line context capture and severity classification
- **AI analysis** provides natural language summary, health rating, and PeopleCode fix previews
- **Interactive chat** for follow-up questions about the trace

## Tech Stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Frontend  | React 18 + Vite                                |
| Backend   | Node.js + Express + WebSocket (ws)             |
| AI        | Multi-provider LLM (Groq, OpenAI, Ollama, etc) |
| Parser    | Custom streaming parser (no AI for parsing)    |

## Prerequisites

- **Node.js 18+** (download from [nodejs.org](https://nodejs.org))
- **One LLM provider** (pick any):
  - [Groq](https://console.groq.com) — free API key, fast inference
  - [Ollama](https://ollama.com) — local, free, no API key needed
  - [OpenRouter](https://openrouter.ai) — free models available
  - [OpenAI](https://platform.openai.com) — paid, GPT-4o-mini
  - [LM Studio](https://lmstudio.ai) — local, free, no API key needed

## Installation

```bash
# Clone or navigate to the project
cd TraceLens

# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Create your environment file
cp .env.example .env
```

## Configuration

Edit `.env` and set your LLM provider:

```bash
# Choose your provider
LLM_PROVIDER=groq

# Set the API key for your chosen provider
GROQ_API_KEY=gsk_your_key_here
```

### Provider-Specific Setup

**Groq (recommended for getting started):**
1. Sign up at [console.groq.com](https://console.groq.com)
2. Create an API key
3. Set `LLM_PROVIDER=groq` and `GROQ_API_KEY=gsk_...`

**Ollama (local, no internet needed):**
1. Install Ollama from [ollama.com](https://ollama.com)
2. Run: `ollama pull qwen2.5-coder:7b`
3. Set `LLM_PROVIDER=ollama`

**OpenRouter:**
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY=sk-...`

**LM Studio:**
1. Install LM Studio, download a model, start the server
2. Set `LLM_PROVIDER=lmstudio`

## Running in Development

```bash
npm run dev
```

This starts both the Express server (port 3000) and Vite dev server (port 5173) with hot reload. Open **http://localhost:5173** in your browser.

## Running in Production

```bash
npm run build
npm start
```

Open **http://localhost:3000**. The built React app is served by Express.

## Switching LLM Provider

Change one line in `.env` and restart the server:

```bash
# Switch from Groq to Ollama
LLM_PROVIDER=ollama

# Switch to OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your_key

# Switch to OpenRouter
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-your_key
```

No code changes required. Just update `.env` and restart with `npm start`.

## Flutter Integration

To embed TraceLens in a Flutter app as a WebView:

```dart
import 'package:webview_flutter/webview_flutter.dart';

class TraceLensView extends StatefulWidget {
  @override
  _TraceLensViewState createState() => _TraceLensViewState();
}

class _TraceLensViewState extends State<TraceLensView> {
  late final WebViewController controller;

  @override
  void initState() {
    super.initState();
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadRequest(Uri.parse('http://localhost:3000'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('TraceLens')),
      body: WebViewWidget(controller: controller),
    );
  }
}
```

## Folder Structure

```
TraceLens/
├── .env.example            # Environment template
├── .gitignore              # Git ignore rules
├── package.json            # Root package (server deps + scripts)
├── README.md               # This file
├── server/
│   ├── index.js            # Express + WebSocket + upload + pipeline orchestration
│   ├── parser/
│   │   ├── streamParser.js # Line-by-line streaming coordinator
│   │   ├── sqlAnalyzer.js  # SQL grouping, N+1 detection, slow query flagging
│   │   ├── loopDetector.js # Sliding window loop pattern detection
│   │   ├── eventParser.js  # PeopleCode event hierarchy + flame chart data
│   │   └── errorParser.js  # Error/warning scanner with context capture
│   └── ai/
│       ├── llmConfig.js    # Multi-provider LLM configuration
│       ├── llmClient.js    # Provider-agnostic streaming LLM client
│       └── llmHealth.js    # GET /api/llm/status health check endpoint
├── client/
│   ├── package.json        # React + Vite dependencies
│   ├── index.html          # HTML entry point
│   ├── vite.config.js      # Vite config with API proxy
│   └── src/
│       ├── main.jsx        # React DOM entry
│       ├── App.jsx         # Root component (WebSocket, state, routing)
│       ├── App.css         # Global layout styles
│       ├── index.css       # CSS reset + dark theme variables
│       └── components/
│           ├── FileUpload.jsx/.css    # Drag & drop file upload
│           ├── ProgressBar.jsx/.css   # Animated parsing progress
│           ├── LLMStatus.jsx/.css     # Provider status indicator
│           ├── ResultsTabs.jsx/.css   # Tab navigation + AI summary
│           ├── FlameChart.jsx/.css    # Pure CSS event flame chart
│           ├── SqlGroups.jsx/.css     # Sortable SQL groups table
│           ├── LoopDetector.jsx/.css  # Loop pattern cards
│           ├── FixPreview.jsx/.css    # Before/after code blocks
│           ├── ErrorPanel.jsx/.css    # Grouped errors with context
│           ├── ValueIssues.jsx/.css   # Variable/null issue list
│           └── ChatPanel.jsx/.css     # Follow-up AI chat
└── uploads/                # Temporary upload storage (gitignored)
```

## Troubleshooting

**"LLM status shows offline"**
- Check your API key in `.env` is correct
- For Ollama/LM Studio, ensure the local server is running
- For Groq/OpenAI, check your internet connection and API quota

**"Upload fails with 413 error"**
- Increase `MAX_FILE_SIZE_MB` in `.env` (default: 1024)

**"WebSocket disconnected"**
- The client auto-reconnects every 3 seconds
- Check that the server is running on the expected port

**"Parse results but no AI analysis"**
- The AI analysis runs after parsing completes
- Check server console for LLM error messages
- Results are still shown even if LLM fails

**"Server crashes on large files"**
- Ensure you have enough disk space for the upload
- The parser uses streaming — memory should stay under ~50MB regardless of file size
- Check Node.js version is 18+ (`node --version`)

**"Vite dev server can't connect to API"**
- The Vite proxy forwards `/api` and `/ws` to `localhost:3000`
- Make sure both servers are running (`npm run dev` starts both)
