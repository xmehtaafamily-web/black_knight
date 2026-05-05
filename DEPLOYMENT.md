# Black_knight Deployment

## Easiest live setup

Use a Node.js hosting platform with PostgreSQL:

- Render
- Railway
- Fly.io
- VPS with Node.js and PostgreSQL

## Required production settings

Set these environment variables on your hosting platform:

```text
PORT=3000
ADMIN_PASSWORD=your-strong-admin-password
DATABASE_URL=postgres://user:password@host:5432/black_knight
```

Most hosting platforms provide `PORT` automatically. If they do, do not override it.

## Build and start command

Install command:

```bash
npm install
```

Start command:

```bash
npm start
```

## URLs

User site:

```text
https://your-domain.com
```

Admin:

```text
https://your-domain.com/admin.html
```

## Video call requirement

WebRTC needs HTTPS in production. Free hosting HTTPS is fine for testing.

For reliable video calls on mobile networks, add a TURN server before launch. STUN alone may fail on strict networks.

## Before public launch

1. Add optional phone/email verification for stronger bans.
2. Add proper admin accounts instead of one shared admin password.
3. Add privacy policy, terms, and 18+ policy pages.
4. Add abuse moderation rules and ban appeals.
5. Add TURN server credentials through environment variables.
