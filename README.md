# ABYSS - Infinite Descent

ABYSS is a fast, procedural tunnel-runner built with Three.js and Vite.

[![Deploy to Cloudflare](https://img.shields.io/badge/Play%20Now-abyss.imidlalo.co.za-F38020?style=for-the-badge&logo=cloudflare)](https://abyss.imidlalo.co.za)
[![Play on GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=for-the-badge&logo=github)](https://bseptember.github.io/abyss-game/)

## Live Links

- **Primary (Cloudflare):** https://abyss.imidlalo.co.za
- GitHub repo: https://github.com/bseptember/abyss-game
- GitHub Pages (fallback): https://bseptember.github.io/abyss-game/

## Controls

- Mouse / Touch: Aim
- WASD / Arrow keys: Steer
- Space / Enter: Start or retry

## Gameplay

- RED barriers are dangerous
- GREEN opening marks the safe gap
- Score increases each gate you pass
- Local top-10 leaderboard is saved in browser storage

## Development

Requirements:

- Node.js 20+

Install and run:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Deployment (Cloudflare)

Hosted like the other iMidlalo games (Workers static assets + custom domain).

| Setting | Value |
|--------|--------|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |
| Custom domain | `abyss.imidlalo.co.za` |

### CLI

```bash
npx wrangler login
npm run deploy
```

Cache headers live in `public/_headers`.

### GitHub Pages (optional fallback)

```bash
npm run build:gh
```

Workflow: `.github/workflows/pages.yml`

## License

This project is distributed under an All Rights Reserved license.
See `LICENSE` for details.
