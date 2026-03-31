# ABYSS - Infinite Descent

ABYSS is a fast, procedural tunnel-runner built with Three.js and Vite.

## Live Links

- Vercel (primary): https://abyss-game-blond.vercel.app
- GitHub repo: https://github.com/bseptember/abyss-game
- GitHub Pages (free hosting target): https://bseptember.github.io/abyss-game/

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

Build with GitHub Pages base path:

```bash
npm run build:gh
```

## Deployment

### Vercel

This project is currently deployed to Vercel.

### GitHub Pages (free)

This repo includes a GitHub Actions workflow at `.github/workflows/pages.yml`.

To enable it:

1. Open repo Settings > Pages.
2. Under Build and deployment, set Source to GitHub Actions.
3. Push to `main` (or run the Pages workflow manually).

After the workflow succeeds, the game is available at:

https://bseptember.github.io/abyss-game/

## License

This project is distributed under an All Rights Reserved license.
See `LICENSE` for details.
