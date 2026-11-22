# Schoolies Mayhem: backlog

Ideas Brent has asked for that aren't in a running round yet. Each one is in his words where it matters.

## Jaz's new missions (start after round A lands; they replace the chip-run opener)

Two linked missions plus a side job. Every possible target shows its own marker at once.

### 1. Party in the Park: hire the party gear
- The goal: hire a sound system, lights and a giant inflatable from the party hire shop for a party in the park. The hire form needs an 18+ to sign and leave a licence.
- A mate first sends you to the wrong places (decoys), and every candidate shop is marked at once.
- **Three routes:**
  - **Talk your way in:** a conversation mini-game. Pick grown-up answers ("I'll need a tax invoice for that") while a suspicion meter rises or falls; anything too teenager-y and you're out.
  - **The cousin's licence:** a mate's older cousin who looks a bit like you lends theirs, but first you have to **get their ute back from the impound yard** at night (side job below).
  - **The disguise:** collect a wig (costume shop), a scarf (op shop), an old-timey hat and a walking stick, put them on (shown on your sprite), and do a wobbly old-person shuffle past the counter. The cashier calls you "love".
- **Success:** the gear is set up in the park (decorations, lights, speakers). It's the same party Merv tries to shut down by kicking the speakers over, so the two characters' nights connect.

### 2. Get into the 18+ beach gig
- **The gig:** a DJ, cool lights and a decorated area on the foreshore liven up the town at night (visible in free roam too, on gig nights).
- **The bouncer** checks ID. The same three routes apply (talk, borrowed licence, disguise). The bouncer is harder to fool than the hire shop, and disguises have to be convincing.

### Side job: the impound yard (for the cousin's licence)
- The car yard has one or two vicious-sounding guard dogs. You need a distraction, and different distractions keep the dogs busy for different lengths of time:
  - a snag from the servo: short;
  - a tennis ball: medium;
  - a whole roast chook: long.
- **The dogs never hurt you:** they pin you down, the owner comes out, and it's the citizen's arrest path (the struggle can wriggle you free).
- Get the ute out (keys in the office, the gate, a quiet exit) and deliver it to the cousin, who then lends the licence.

### Also
- **Bowls:** keep the bowls club, and let any character pay to play a game (Round B's bowls mini-game, with a fee).
- **Postie bike:** a postie-style step-through motorbike (Brent liked it; Round B).

## Launch round (after rounds A and B land)
Brent approved (22 Nov 2026) creating a **public** repo `br3nt/schoolies-mayhem` for GitHub Pages once rounds A and B have landed.
- **The public repo holds only the game** (copied from `game/`, without `data/raw/`, `tools/` test scratch, or anything from the traffic project). The licence notes keep the OpenStreetMap ODbL credit.
- **Share card:** `og:title`, `og:description`, `og:image` (designed 1200×630: logo, the town at night, the three characters), `og:url`, `og:type`, `twitter:card=summary_large_image`, all with absolute URLs. Check with Facebook's Sharing Debugger.
- **Instagram** shows no link cards in feed posts, so make a 15–30 s gameplay trailer clip and stills for posts and stories.
- **itch.io:** a build script that zips the game (index.html at the root), plus a cover image and screenshots in itch sizes. Brent uploads it himself.
- **Music:** original, reactive tracks only. No recognisable copies of copyrighted songs.
  - Jaz gets party and EDM/doof, Merv gets swing, crooner and 60s–70s pub-rock style, Kev gets a 2000s pop-punk, indie and 2010s pop feel.
  - Intensity rises through chases, police attention and struggles.
  - Public-domain classics are fine for Merv (ragtime, marches, maybe "Waltzing Matilda").
  - Spotify can be used read-only to set the tempo and style targets from current charts.
- **Sound effects pass:** doors, dogs, party crowds, rotor wash, bikes and motorbikes, and boats.
- **Feedback links** in the title and pause menus (open in a new tab):
  - "Report a bug" opens a GitHub issue form, pre-filled with the game version, browser, character, night and job.
  - "Suggest an idea" opens GitHub Discussions (an "Ideas" category, with upvotes).
  - Enable Discussions and add the issue templates in the public repo.
  - Say that GitHub needs an account; offer an email alternative only if Brent provides one.

## Steam round (later, if the free launch catches on)
- **Brent does himself:** the Steamworks partner signup and the US$100 Steam Direct fee, plus identity, tax and bank checks.
- **Desktop wrapper** (Electron or Tauri) with Windows and macOS builds and full-screen support.
- **Controller support** throughout: menus, driving, on foot, the mini-games.
- **Steamworks integration:** achievements (map the badges from round D), cloud saves, and rich presence ("Night 2 · Party in the Park").
- **Store page:** capsules in all sizes, a trailer, screenshots, a description and the content survey, with a "coming soon" page live at least 2 weeks before launch.
- **Commercial tidy-up:**
  - keep everything original (music, art);
  - keep the OpenStreetMap credit;
  - make sure no real business names or logos remain;
  - consider moving the lock-up to a building that isn't recognisably a real private venue (Mount Breckan).

## Round D (after rounds A and B land)

### Garage upgrades at the real repair places
- Drive in, the roof cuts away (like the walk-in shops), and a garage menu opens. Everything costs money.
- **Different places offer different upgrades**, so you have to explore the town to find them all:
  - **Smash repairers** (FLEURIEU SMASH): respray, dent repair, body armour or bull bar, maybe a "stealth" matte paint.
  - **Mechanics** (ULTRA TUNE-UP, AUTO MASTAS): engine (top speed), acceleration, brakes.
  - **Tyre places** (VICTOR TYRE POWER, the Bridgestone site): tyres (grip, drift, sand and grass handling), wheels.
  - **Car dealer** (Adelaide Rd): wraps and two-tone paint, and possibly selling or swapping cars.
  - **Parts shop** (VICTA AUTO PARTS): bolt-ons (exhaust, spoiler, nitrous-style boost, roof lights for Kev).
  - **Mobility-scooter shop:** gopher upgrades (already started: double battery, racing stripe).
- Each place shows what it sells on its sign and in the map legend, plus stats before and after you buy.
- Upgrades stay with that car; Kev's police car keeps his.

### Achievements and badges
- A badge collection screen with a pop-up when you earn one. Saved in localStorage and kept across nights and sessions, like Steam.
- **Collection badges:** all 20 lost thongs, every respray or garage visited, every shop entered, every upgrade place found.
- **Stunt badges:** BMX and skate tricks, jet-ski flips, speedboat jumps, long drifts, big airtime.
- **Story and mayhem badges:** each character's week finished, a no-bust night, wins at bowls and HORSE, a five-curtain escape.

### Locals with little goals
- Townsfolk with a speech bubble who want something:
  - the bowls club lady's lost bowl;
  - bait for the fisherman;
  - a kid's footy off a roof;
  - scare the seagulls off the café.
- **Rewards:** cash, clothes or hats, car colours, upgrade discounts, BMX or jet-ski paint, or hints to hidden stashes.

## Content rules (all rounds)
- **No weapons. No shooting and no tasers, for anyone, ever** (Brent, 22 Nov 2026; this replaces the earlier "cops may taser or shoot" rule). An arrest is enough: chases, box-ins, roadblocks, spikes, PITs, and the tackle and cuff struggle.
- Pedestrians are never hurt; they jump out of the way. No drugs or alcohol. No real named people.
- Original game: no Grand Theft Auto names, logos or UI copies.

## Process rules (all rounds)
- Validate every job by playing it with input-only scripts in `game/tests/`: no state hacks, failure paths included.
- Jobs declare their `requires()` for the dead-end card (Restart job / Restart night / Keep playing).
- One shared movement and collision path for every actor and vehicle.
- Invalid placements must be impossible by construction. Spawns only come from typed slots that are baked and validated at map-build time (outside buildings, off water or on water as appropriate, clearance free, reachable by the right access mode), and only through `Spawn.pick`. A test bans raw-coordinate spawns.
- Playful names are fine if the twist still relates to the thing (e.g. ULTRA TUNE-UP, not ULTRA TOON).
