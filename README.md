# Blue Claw

Blue Claw is a new OpenClaw rare species: a tiny, local-first personal AI assistant stripped down to the essentials so it is easier to set up and easier to use.

## What makes it simpler

- One Node server instead of a large multi-package platform
- One browser UI instead of multi-channel messaging integrations
- Local chat history stored in `data/sessions.json`
- OpenAI-compatible configuration through a single `.env` file
- Two commands to start: install once, then run

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template:

   ```bash
   copy .env.example .env
   ```

3. Edit `.env` and set:

   - `OPENAI_API_KEY`
   - Optional: `OPENAI_BASE_URL`
   - Optional: `OPENAI_MODEL`
   - Optional: `SYSTEM_PROMPT`

4. Start Blue Claw:

   ```bash
   npm start
   ```

5. Open the local URL shown in the terminal. It will usually be [http://localhost:3000](http://localhost:3000), and Blue Claw will automatically try the next port if `3000` is already in use.

## Environment variables

- `OPENAI_API_KEY`: required
- `OPENAI_BASE_URL`: defaults to `https://api.openai.com/v1`
- `OPENAI_MODEL`: defaults to `gpt-4o-mini`
- `SYSTEM_PROMPT`: defaults to Blue Claw's assistant prompt
- `PORT`: defaults to `3000`

## Scripts

- `npm start`: run the app
- `npm run dev`: run with Node watch mode

## Project structure

- `server.js`: API server and local storage
- `public/`: browser app
- `data/`: generated local chat history

## Notes

- This is intentionally much smaller than OpenClaw. It focuses on chat and local session history only.
- The app uses the OpenAI-compatible `chat/completions` endpoint so it can work with OpenAI and compatible providers.
