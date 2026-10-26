# HallFinder API

Node.js + Express + SQLite backend for HallFinder, an indoor campus navigation and timetable system.

## Run locally
Requires Node 22.13 or newer (uses the built-in `node:sqlite`, so there is no database to install).

```bash
npm install
cp .env.example .env     # optional, defaults work
npm run dev              # http://localhost:4000
npm test                 # 13 API tests
```
The first start creates and seeds a demo campus (3 buildings, 60 rooms, 10 teachers, 10 students, weekly timetable). `npm run seed` resets it.

## Demo accounts (password `demo1234`)
- student@hallfinder.demo
- teacher@hallfinder.demo
- admin@hallfinder.demo

## Environment variables
| Name | Purpose |
| --- | --- |
| `PORT` | Port to listen on (Railway sets this for you) |
| `JWT_SECRET` | **Set a long random value in production** |
| `DATABASE_PATH` | SQLite file path. On Railway, mount a Volume and point this at it, for example `/data/hallfinder.db` |
| `CLIENT_ORIGIN` | Your frontend URL for CORS, for example `https://hallfinder.netlify.app`. Comma separate several. |
| `SCHOOL_TZ` | School time zone, default `Africa/Douala` |
| `SCHOOL_NAME` | Shown in the app |

## Deploy on Railway
1. Push this folder to its own GitHub repo, then "New Project" > "Deploy from GitHub".
2. Add a Volume mounted at `/data` and set `DATABASE_PATH=/data/hallfinder.db`.
3. Set `JWT_SECRET` and `CLIENT_ORIGIN`. Railway runs `npm start`.

## What is real and what is a demo
- Real: accounts, roles, timetable, conflict detection, shortest-path routing (stairs-free option), turn-by-turn text, reminders, announcements, admin tools.
- Demo: sensor readings and teacher attendance are generated (responses carry `simulated: true`). Email and password reset are stubs. The `X-Demo-Now` header lets the frontend show a simulated time.
- There is no real indoor GPS. The frontend gets a location from door QR codes or a chosen start point. To go further, add BLE beacons or Wi-Fi positioning and feed the result into `/api/route?from=`.
