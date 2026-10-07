# Countersign basic login

A small, runnable starting point for the Countersign workspace. The interface is in English. It includes registration, email/password login, password visibility, input validation, error/loading states, a signed-in account page and logout. It works on desktop and mobile.

This is a new implementation for your project. The x402ops repository was reviewed as a product reference; its code and Privy integration were not copied.

## Run locally

Install **Node.js 22 or newer** if it is not already installed. No package installation, database service or API key is required.

Open a terminal in this folder and run:

```powershell
node server.mjs
```

Visit **http://127.0.0.1:3000**. Select **Create account**, enter your name/email and a password of 10–128 characters, and submit. After signing out, use the same credentials to sign in again. Accounts survive a server restart. Sessions last eight hours and end when the server restarts.

To choose another port in PowerShell:

```powershell
$env:PORT = '3001'
node server.mjs
```

Run checks:

```powershell
node --test test/auth.test.mjs
```

## Project structure

- `public/index.html`: login, registration and signed-in page.
- `public/styles.css`: responsive appearance.
- `public/app.js`: form validation and API calls.
- `server.mjs`: authentication API and static-file server.
- `test/auth.test.mjs`: authentication and access-control checks.
- `data/users.json`: automatically generated, private local account store, excluded from Git.

## API

| Endpoint | Behavior |
| --- | --- |
| `POST /api/register` | Takes `name`, `email`, `password`; creates an account and starts a session. |
| `POST /api/login` | Takes `email`, `password`; verifies credentials and starts a session. |
| `GET /api/me` | Returns the current user, or HTTP 401. |
| `POST /api/logout` | Invalidates the session and clears its cookie. |

POST requests must use JSON and a matching `Origin`. The UI sets this automatically through the browser. User responses exclude password hashes and salts.

## What this version protects

Passwords are hashed with Node's scrypt and a unique random salt. The server issues random sessions in HttpOnly, SameSite=Strict cookies; the browser does not store passwords or session tokens in localStorage. Login rotates the current session; logout invalidates it on the server. Authentication endpoints limit attempts to 20 per socket IP per 15 minutes. Static serving uses an explicit allowlist so account files are not publicly accessible. A content security policy blocks inline/remote scripts and framing.

**Workspace login does not grant payment, Owner or administrator permissions.** There is no wallet connection, invoice processing, funding, transaction signing or financial-role assignment in this version. Those need separate authenticated server-side authorization and contract checks when implemented.

## Development limitations and deployment

This is a local foundation, not a production identity service. It has no email verification, password reset, MFA, organization invitations or recovery. Accounts are self-service and unverified. The JSON store and in-memory sessions/rate limits support **one server process** only; do not run multiple replicas against it. Do not use it for real funds. Before a public financial deployment, replace storage/session management with a proper database or identity provider, add verification/recovery/MFA and define workspace roles separately from payment authority.

For an HTTPS-hosted preview, set these in your host's environment:

```text
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=https://your-actual-domain.example
SECURE_COOKIES=true
DATA_DIR=/private-persistent-volume/countersign
```

The `.env.example` is a template; the server reads shell/hosting environment variables and does not automatically load `.env` files. Use an HTTPS reverse proxy and persistent private storage. Never expose the `data` directory. The IP limiter deliberately ignores forwarded headers; behind a proxy it may group users together, so use a trusted proxy/edge limiter before public deployment. Hosting on static GitHub Pages alone will not run this Node backend.

## Upload to your own GitHub

Create an empty GitHub repository, then run in this folder (replace the placeholder with your own repository URL):

```powershell
git init
git add .
git commit -m "Add Countersign basic login"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Before uploading, confirm `.gitignore` is included. Do not upload `.env`, real user data, passwords or API credentials. No GitHub upload is performed automatically by this project.
