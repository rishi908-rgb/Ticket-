# Pixel Node Ticket Bot (Premium - Select Menu)

This repo is preconfigured with your server IDs in the `.env` file. **You must add your bot TOKEN before running.**

## What you must do
1. Open `.env` and paste your bot token:
```
TOKEN=YOUR_BOT_TOKEN_HERE
TICKET_CATEGORY_ID=1427660344108650518
STAFF_ROLE_ID=1433500191448764506
LOG_CHANNEL_ID=1427660525558562877
```

2. Install dependencies:
```bash
npm install
```

3. Run locally:
```bash
node index.js
```

Or deploy to Render:
- Push to GitHub and connect to Render.
- In Render, add the same environment variables (preferred: set TOKEN there, don't store it in repo).

## Usage
- In any channel, type:
```
!ticketpanel
```
to post the select-menu ticket panel.

- Users select category → private ticket channel is created.
- Buttons inside the ticket: Close Ticket, Save Transcript.

**Security note:** Do NOT share your bot token with anyone. Keep it secret.

