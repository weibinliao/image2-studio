# Image2 Studio

Image2 Studio is a self-hosted web console for multi-provider image generation. It supports OpenAI-compatible image APIs and Gemini native image generation, with separate administrator and member views.

The repository contains application source code only. API keys, channel configuration, generated images, user history, audit logs, and runtime settings are intentionally excluded.

## Features

- Text-to-image and image-to-image workflows
- OpenAI-compatible and Gemini native provider adapters
- Multiple channels with health checks, cooldowns, and safe failover
- Administrator-controlled image engines and default models
- Automatic or manual engine selection for members
- Upstream model discovery with image-only filtering
- Real generation tests before changing a production model
- Prompt assistance, generation history, lightbox zoom, downloads, and retries
- LAN access with local administrator controls

## Requirements

- Node.js 18 or newer
- An API key and base URL from your own image-generation provider

No third-party npm packages are required.

## Quick Start

~~~powershell
git clone https://github.com/YOUR_ACCOUNT/image2-studio.git
cd image2-studio
Copy-Item .env.example .env
npm start
~~~

Open http://localhost:3020 on the host computer. The process runs in the background and writes local logs under .local/logs/.

Use the settings drawer on the host computer to add your own channels. Image2 Studio probes the channel and detects either:

- openai-images: OpenAI-compatible image endpoints
- gemini-native: Gemini generateContent image generation

After adding channels, create one or more image engines, assign compatible channels, choose a tested model, and enable the engine for members.

## Environment Configuration

Copy .env.example to .env and fill in only your own provider details.

~~~env
PORT=3020
HOST=0.0.0.0
PUBLIC_LAN_IP=
IMAGE2_BASE_URL=https://api.example.com/v1
IMAGE2_MODEL=gpt-image-2
IMAGE2_API_KEYS=
REQUEST_TIMEOUT_MS=180000
~~~

OpenAI-compatible channels can also be declared through numbered environment variables:

~~~env
IMAGE2_CHANNEL_1_NAME=primary
IMAGE2_CHANNEL_1_BASE_URL=https://api.example.com/v1
IMAGE2_CHANNEL_1_API_KEY=replace-with-your-key
IMAGE2_CHANNEL_1_ENABLED=true
~~~

For Gemini native channels, use the administrator UI so the saved channel includes the correct gemini-native protocol type.

## Security And Privacy

- Never commit .env or files created under data/.
- Full API keys stay on the server. Browser APIs receive masked keys only.
- Generated images, user history, audit logs, settings, cookies, and server secrets are runtime data and are ignored by Git.
- The repository starts with no configured channels and no generated images.
- Treat LAN exposure as private-network access. Put an authenticated reverse proxy in front of the app before exposing it to the public internet.

The included .gitignore excludes local credentials and runtime data by default.

## Commands

~~~powershell
npm start            # Start in the background
npm run foreground   # Run in the current terminal
npm stop             # Stop the background process
npm run check        # Syntax and UI geometry checks
npm test             # Full test suite
~~~

## Project Structure

~~~text
server.js                 HTTP server, APIs, jobs, history, and routing
image-providers.js        OpenAI-compatible and Gemini provider adapters
engine-routing.js         Engine validation, model selection, and failover
provider-models.js        Provider defaults and capabilities
key-provider-store.js     Provider type persistence and migration
public/                   Browser application
scripts/                  Startup, validation, migration, and tests
data/outputs/.gitkeep     Empty runtime output directory marker
~~~

## License

MIT
