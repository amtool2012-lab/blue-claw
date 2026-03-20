# Blue Claw

Blue Claw is a new OpenClaw rare species: a tiny, local-first personal AI assistant stripped down to the essentials so it is easier to set up and easier to use.

## What makes it simpler

- One Node server instead of a large multi-package platform
- One browser UI instead of multi-channel messaging integrations
- Local chat history stored in `data/sessions.json`
- OpenAI-compatible configuration through a single `.env` file
- Built-in local actions for shell commands, app launching, and browser opening
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

3. Edit `.env` and set either OpenAI or OpenRouter:

   OpenAI:

   - `AI_PROVIDER=openai`
   - `OPENAI_API_KEY`
   - Optional: `OPENAI_BASE_URL`
   - Optional: `OPENAI_MODEL`

   OpenRouter:

   - `AI_PROVIDER=openrouter`
   - `OPENROUTER_API_KEY`
   - `OPENAI_BASE_URL=https://openrouter.ai/api/v1`
   - `OPENAI_MODEL=<provider/model-name>` such as `openai/gpt-4o-mini`
   - Optional: `OPENROUTER_SITE_URL`
   - Optional: `OPENROUTER_APP_NAME`

   Common:

   - Optional: `SYSTEM_PROMPT`

4. Start Blue Claw:

   ```bash
   npm start
   ```

5. Open the local URL shown in the terminal. It will usually be [http://localhost:3000](http://localhost:3000), and Blue Claw will automatically try the next port if `3000` is already in use.

## Environment variables

- `AI_PROVIDER`: `openai` or `openrouter`
- `OPENAI_API_KEY`: OpenAI key when using OpenAI
- `OPENROUTER_API_KEY`: OpenRouter key when using OpenRouter
- `OPENAI_BASE_URL`: defaults to the provider's standard API base URL
- `OPENAI_MODEL`: defaults to `gpt-4o-mini` for OpenAI and `openai/gpt-4o-mini` for OpenRouter
- `OPENROUTER_SITE_URL`: optional `HTTP-Referer` header for OpenRouter
- `OPENROUTER_APP_NAME`: optional `X-Title` header for OpenRouter
- `SYSTEM_PROMPT`: defaults to Blue Claw's assistant prompt
- `PORT`: defaults to `3000`

## Scripts

- `npm start`: run the app
- `npm run dev`: run with Node watch mode

## Local actions

Blue Claw can perform a few local actions after an explicit approval click in the web UI:

- `/cmd <powershell command>`: queue a shell command
- `/app <application name or path>`: launch an app or file
- `/browse <url or search query>`: open a browser page or search
- `/open <url or search query>`: same as `/browse`
- `/help`: show local action help

Examples:

```text
/cmd Get-ChildItem
/app notepad
/browse openai.com
/browse best local ramen near me
```

## Project structure

- `server.js`: API server and local storage
- `public/`: browser app
- `data/`: generated local chat history

## Notes

- This is intentionally much smaller than OpenClaw. It focuses on chat and local session history only.
- The app uses the OpenAI-compatible `chat/completions` endpoint so it can work with OpenAI and OpenRouter.
