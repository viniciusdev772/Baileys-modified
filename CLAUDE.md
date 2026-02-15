# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Baileys is a TypeScript/JavaScript library that provides a WebSocket-based interface to the WhatsApp Web API. It implements the Signal Protocol for end-to-end encryption and handles the binary WhatsApp protocol for message encoding/decoding.

## Build & Development Commands

```bash
# Install dependencies
yarn

# Build TypeScript to lib/
yarn build

# Build everything (TS + docs)
yarn build:all

# Run the example
yarn example

# Run unit tests
yarn test

# Run E2E tests (requires real WhatsApp connection)
yarn test:e2e

# Run a specific test file
node --experimental-vm-modules ./node_modules/.bin/jest --testMatch '**/<filename>.test.ts'

# Lint
yarn lint

# Lint with auto-fix
yarn lint:fix

# Generate protobuf definitions
yarn gen:protobuf
```

**Requirements:** Node.js >= 20.0.0, Yarn 4.x

## Architecture

### Socket Layer (Decorator/Composition Pattern)

The socket is built as a layered composition where each layer adds functionality on top of the previous:

```
makeWASocket (index.ts)
└── makeCommunitiesSocket (communities.ts) - WhatsApp communities
    └── makeBusinessSocket (business.ts) - Business profile features
        └── makeNewsletterSocket (newsletter.ts) - Channels/Newsletters
            └── makeGroupsSocket (groups.ts) - Group management
                └── makeChatsSocket (chats.ts) - Chat operations, privacy, sync
                    └── makeMessagesSocket (messages-send.ts) - Message sending/encryption
                        └── makeMessagesRecvSocket (messages-recv.ts) - Message receiving/decryption
                            └── makeMexSocket (mex.ts) - Multi-device encryption
                                └── makeSocket (socket.ts) - Base WebSocket connection
```

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/Socket/` | Layered socket architecture |
| `src/Socket/Client/` | Low-level WebSocket client |
| `src/Types/` | TypeScript interfaces (Auth, Events, Messages, etc.) |
| `src/Utils/` | Utilities for crypto, media, auth state, signal protocol |
| `src/WABinary/` | WhatsApp binary protocol encoding/decoding |
| `src/Signal/` | Signal Protocol implementation (libsignal) |
| `src/Signal/Group/` | Sender Key group encryption |
| `WAProto/` | Compiled Protobuf definitions |
| `Example/` | Working usage example |

### JID (Jabber ID) Format

WhatsApp identifiers follow specific formats:
- **User:** `[country-code][number]@s.whatsapp.net` (e.g., `5511999999999@s.whatsapp.net`)
- **Group:** `[group-id]@g.us`
- **Broadcast/Status:** `status@broadcast`
- **Newsletter:** `[id]@newsletter`

### Key Events

Primary events emitted by `sock.ev.on()`:
- `connection.update` - Connection status (QR code, connected, disconnected)
- `creds.update` - Credentials updated (must save auth state)
- `messages.upsert` - New messages received
- `messages.update` - Message updates (status, reactions, polls)
- `groups.update` - Group changes
- `chats.upsert` - New chats

### Auth State

Use `useMultiFileAuthState()` for simple file-based persistence. For production, implement a custom store with database backing. Signal sessions update frequently and must be persisted on `creds.update`.

## Optional Dependencies

- `jimp` or `sharp` - Image thumbnail generation
- `link-preview-js` - Link preview generation
- `ffmpeg` (system) - Video thumbnails and audio conversion

## Protobuf

Protobuf definitions are in `WAProto/WAProto.proto`. After modifying, run:
```bash
yarn gen:protobuf
```
This generates `WAProto/index.js` and `WAProto/index.d.ts`.
