# Black_knight MVP

This is the first realtime MVP for a preference-based random chat and video matching site.

## Run locally

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Current prototype

- Guest profile setup
- Direct guest access without OTP
- Gender and match preference selection
- Separate Chat and Video Chat modes
- 18+ confirmation
- Socket.io waiting-room matching by gender preference and selected mode
- Live text chat between matched users
- WebRTC camera and microphone video calls in Video Chat mode
- Next, block, and report controls
- Reports saved to `reports.json`
- Basic admin reports page at `/admin.html`
- Admin can mark reports reviewed and ban reported verified contacts

## Admin note

The admin page is only for MVP testing. Open `/admin.html` and log in with the local default password:

```text
blackknight123
```

For anything public, set your own password before starting the server:

```bash
ADMIN_PASSWORD=your-strong-password npm run dev
```

Before launch, move reports to a real database and use proper admin accounts.

## Guest access note

The app currently allows direct guest matching without OTP. This reduces signup friction, but bans are weaker because users can change display names. For a serious public launch, add phone/email verification again.

## Database

Reports and bans use PostgreSQL when `DATABASE_URL` is set. If it is not set, the app falls back to local JSON files for MVP testing.

```bash
DATABASE_URL=postgres://user:password@localhost:5432/black_knight npm run dev
```

The server creates the `reports` and `bans` tables automatically on startup.

## Next build steps

1. Move admin sessions into PostgreSQL or Redis.
2. Add optional phone/email verification for stronger bans.
3. Add database-backed admin users and roles.
4. Add TURN server support for stricter networks.
5. Add production deployment setup.
