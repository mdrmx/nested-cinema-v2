# Nested Cinema v2

An Electron-based multi-screen cinema controller that synchronises a wall video display, mobile VR headsets (A-Frame), and a Max/MSP surround-sound patch over a local HTTPS/WebSocket network.

## Architecture overview

```
Electron host (main.js)
├── Operator window  — playback controls (controls/)
├── Wall renderer    — full-screen video display (renderer-wall/)
├── HTTPS server     — serves mobile VR client (port 5173)
├── WSS server       — real-time sync to all clients (port 5173)
└── HTTP server      — CA certificate download for mobile devices (port 5174)

Mobile VR client (mobile/vr.html) — connect from headset browser
Max/MSP patch (max-surround-control/) — connects as a WebSocket client
```

## Getting the project

If you're new to Git, follow these steps to download the project to your computer.

### 1. Install Git

Check whether Git is already installed by opening a terminal and running:

```bash
git --version
```

If you see a version number, you're good to go. If not, download and install it from [git-scm.com](https://git-scm.com/downloads).

### 2. Clone the repository

```bash
git clone https://github.com/mdrmx/nested-cinema-v2.git
```

Replace the URL with the actual repository URL (ask the project owner if you're unsure).

### 3. Enter the project folder

```bash
cd nested-cinema-v2
```

You're now inside the project. Continue with the **Setup** steps below.

---

## Prerequisites

| Tool                                            | Install                    |
| ----------------------------------------------- | -------------------------- |
| [Node.js](https://nodejs.org) ≥ 18              | `brew install node`        |
| [mkcert](https://github.com/FiloSottile/mkcert) | `brew install mkcert`      |
| [Max/MSP](https://cycling74.com) _(optional)_   | for surround-sound control |

> **Windows / Linux:** replace `brew install` with your platform's package manager. See the mkcert README for details.

## Setup

### 1. Install dependencies

```bash
# Root app
npm install

# Max/MSP WebSocket bridge (optional)
cd max-surround-control && npm install && cd ..
```

### 2. Install the local certificate authority

This only needs to be done once per machine. It makes browsers trust the self-signed certificates generated in the next step.

```bash
mkcert -install
```

> On macOS you may be prompted for your system password to add the CA to the keychain.

### 3. Generate TLS certificates

```bash
npm run gencerts
```

This creates `certs/cert.pem` and `certs/key.pem` scoped to `localhost`, `127.0.0.1`, your machine's hostname, and your current LAN IP. **Re-run this command whenever your LAN IP changes.**

### 4. Add media files

Place media into the gitignored `media/` directory:

```
media/
  wall/    ← video files for the wall screen
  vr/      ← 360° video files for VR headsets
```

File references in `cues.json` use the base filename (e.g. `"clipId": "vr1"` maps to `media/vr/vr1.*`).

### 5. Launch the app

```bash
npm start
```

The Electron window opens with the operator controls. The wall renderer opens as a second window (move it to your display wall).

## Connecting clients

### Mobile VR headsets

1. On the host machine, note the LAN IP printed in the terminal (or check **System Settings → Network**).
2. On the headset browser, navigate to:  
   `https://<LAN-IP>:5173/mobile/vr.html`
3. On first visit, the browser will warn about an untrusted certificate. To fix this permanently, download and install the CA on the headset by visiting:  
   `http://<LAN-IP>:5174/ca.crt`  
   then re-navigate to the HTTPS URL.

### Max/MSP surround-sound patch

1. Open `max-surround-control/nested-cinema-sound-patch.maxpat` in Max.
2. The patch connects to the WSS server automatically. Ensure the host IP/port in the patch matches (`ws://localhost:5173` by default for local use).

## Cue editing

Edit `cues.json` to define the timeline. Each cue object requires at minimum:

```json
{ "time": <seconds>, "type": "<cueType>", ... }
```

Supported types: `trigger360`, `stop360` (extend as needed in `main.js`).

## Scripts

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `npm start`        | Launch the Electron app                      |
| `npm run gencerts` | Regenerate TLS certificates for this machine |
