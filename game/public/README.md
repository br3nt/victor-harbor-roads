# Schoolies Mayhem

**Schoolies week in Victor Harbor. Nobody's getting any sleep.**

The schoolies have arrived ready to party. The locals are frustrated. The police are on high alert.

▶ **Play it in your browser:** https://br3nt.github.io/schoolies-mayhem/

A top-down pixel-art caper set in the real streets of Victor Harbor, South Australia, built from OpenStreetMap data. Pick your player:

- **Jaz, the schoolie:** ding-dong-ditch the town, borrow the horse tram, ride the steam train and become a Schoolies legend.
- **Merv, the gopher grump:** 81 years young, one mobility scooter, zero patience. The doof-doof has kept him up three nights running. It ends now.
- **Constable Kev:** senior constable at the little Victor Harbor station, with schoolies on one side and gophers on the main road on the other.

> 🚧 **Work in progress.** New changes land often. If a newer version comes out while you're playing, the game tells you and offers a reload.

## Controls

WASD or the arrow keys to move or drive · **E** get in or out · **Space** handbrake · **Shift** run or boost · **F** kick · **H** horn, siren or shout · **J** current job · **M** map · **?** help · **Esc** pause. Touch controls appear on phones.

## Found a bug? Got an idea?

- 🐛 **Bugs:** [open an issue](https://github.com/br3nt/schoolies-mayhem/issues/new/choose).
- 💡 **Ideas:** post them in [Discussions → Ideas](https://github.com/br3nt/schoolies-mayhem/discussions/categories/ideas).
- 🏖️ **Local lore:** in-jokes, local history, legendary past Schoolies parties, the stories locals tell. Share them in the pinned [Lore and local legends](https://github.com/br3nt/schoolies-mayhem/discussions) discussion and they may end up in the game.

## Fix it yourself, with your coding agent 🤖

This game is built to be worked on with AI coding agents, and contributions are very welcome. Point yours (Claude Code, Codex, Copilot, Cursor, …) at this repo and ask it to fix a bug or build a feature from the issues or discussions, then open a pull request.

Your agent should read [`AGENTS.md`](AGENTS.md) first. It explains how the game is put together, the rules every change must follow, and the checks to run before a PR. In short:

- plain JavaScript and Canvas 2D, with no build step: just open `index.html` from any static web server;
- everything walks and drives through one shared movement and collision path;
- things only spawn on pre-validated spots (`Spawn.pick`), never at raw coordinates;
- no weapons, no real people, and only original art, sound and music;
- run the lint and the input-only playthrough tests, and include a screenshot or short clip in the PR.

## Credits

A game by **Brent Jacobs**, 2026. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence (ODbL). Music and sound are original, synthesised in the browser.

*Names have been changed to protect the identities and reputations of those involved. Merv insisted. Any resemblance to real gophers, living or dead, is purely coincidental.*

Part of the [Victor Harbor roads project](https://br3nt.github.io/victor-harbor-roads/) · [Brent's blog](https://br3nt.github.io/)
