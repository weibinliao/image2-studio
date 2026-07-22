# Image2 Studio

Local web console for calling an OpenAI-compatible image generation API.

## Start

```powershell
npm start
```

`npm start` runs the server in the background and writes logs to `.local/logs`.
Open `http://localhost:3020` on this computer.

For foreground debugging:

```powershell
npm run foreground
```

To stop a background process started by `npm start`:

```powershell
npm run stop
```

For LAN access, keep the computer and other devices on the same network and open the printed LAN URL, for example `http://192.168.1.10:3020`.

## Config

Copy `.env.example` to `.env` and fill in your own upstream provider details.
Secrets stay server-side in `.env` or `data/keys.json`.

```env
PORT=3020
HOST=0.0.0.0
PUBLIC_LAN_IP=10.8.66.135
IMAGE2_BASE_URL=https://example.com/v1
IMAGE2_MODEL=image2
IMAGE2_USER_CHANNEL_ID=channel-1
IMAGE2_ADMIN_CHANNEL_ID=channel-2
IMAGE2_API_KEYS=sk-xxx,sk-yyy
REQUEST_TIMEOUT_MS=180000
```

Multiple upstream channels can also be configured independently:

```env
IMAGE2_CHANNEL_1_NAME=primary
IMAGE2_CHANNEL_1_BASE_URL=https://api.example.com/v1
IMAGE2_CHANNEL_1_API_KEY=sk-xxx

IMAGE2_CHANNEL_2_NAME=backup
IMAGE2_CHANNEL_2_BASE_URL=https://backup.example.com/v1
IMAGE2_CHANNEL_2_API_KEY=sk-yyy
```

`IMAGE2_USER_CHANNEL_ID` is the fixed channel used for member image generation. `IMAGE2_ADMIN_CHANNEL_ID` is the fixed channel used when the local admin clicks "Start generation". The admin UI also has an "admin test channel" dropdown; that one only affects reading models and running model test images, and does not change either fixed generation channel.

The browser never receives full API keys. The key list API only returns masked keys.

Runtime data in `data/`, generated images, local logs, and browser preview caches
are intentionally ignored by Git so the repository can be published safely.
