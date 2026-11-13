# Whereabout

**Can you beat the AI at guessing where in the world a photo was taken?**

**[▶ Play it now](https://playwhereabout.netlify.app)**

Whereabout is a geography game played against **Atlas**, a computer-vision model. You look at a
photo, drop a pin on a 3D globe, and guess. Then the globe goes full screen: arcs draw from your
pin and Atlas's pin to the true location, the gold pin drops, and the distances count up.

Each visit opens a fresh random game of five photos, avoiding ones you've played recently. The
**Daily Five** (the same photos for everyone each day, so you can compare scores with friends) is
one button away, or at `?daily`; missed one? The results screen has a calendar of the last 30
Daily Fives with your score on each, and any of them plays at `?daily=2026-10-20`. Next to it you can pick **Easy, Medium or Hard**, graded by how far
Atlas actually missed each photo (or open `?tier=hard`), or one continent, so every photo was taken
in, say, South America (`?region=south-america`). The share text gives no spoilers.
**Challenge a friend** from the results: the link deals your friend the same five photos with
your score on each to beat, and they can send theirs straight back. At the end of a friend's
challenge, *Share head to head* draws both results photo by photo as a picture (who took each
photo, and the game), spoiling no place, and sends it with the link to answer it. Hot and cold,
How far apart?, Close-up and Line them up challenges end with one too, in their own units (the
pin that found each country; how many times over or under each estimate was; the name that found
each crop; how many photos were in place on each row). Odd one out, Further North, Which way?,
Name the country and Country Streak draw both runs call by call, right, wrong or not reached, so the picture shows where each run
ended; a long run folds its matching stretches into one row ("Quads 1–14"). Survival draws both
health bars photo by photo, the health left after each and "Out" where each run ended, and a long
run keeps both endings while it folds the photos between ("Photos 8–26").
**Blitz** (`?blitz`) gives each photo 30 seconds on a countdown ring: when time runs out your
guess goes in wherever the pin is, and with no pin the round scores 0. The clock waits for the
photo to load and pauses while the tab is hidden; your best Blitz is kept in your browser.
*Challenge a friend* after a Blitz sends a link that also carries the seconds you had left on each
photo: your friend plays the same five photos on the same 30-second clock, and at each reveal sees
what you scored there and with how long to spare. A challenge never counts toward your best Blitz.
**Country Streak** (at `/streak`) asks only for the country: tap it on the globe, one photo after
another, until your first miss. Pick a continent to deal only photos taken there
(`/streak?region=europe`, or straight from a continent game); each continent keeps its own best
streak in your browser beside the one from anywhere. After a run, *Challenge a friend* sends a
link to the very same photos in the same order (and the same continent), with your streak to beat;
on the photo that ended your run your friend sees the country you tapped, once they have answered
it. A challenge never counts toward your best.
**Survival** (at `/survival`, linked from the results screen) deals photo after photo until your
misses empty a 5,000-point health bar: each round costs half the points it missed, a pin within
25 km heals 1,000 instead, and your best run (photos survived, then points) is kept in your browser.
When the bar runs out, *Challenge a friend* sends a link to the very same photos in the same order,
with your health after each: your friend sees a tick on their bar where yours stood at that point,
and after each photo what you had left, and a friend who outlasts you plays on through the rest of
the deck. Photos survived decide it, then points. A challenge never counts toward your best.
**Further North** (at `/further-north`, linked from the results screen) shows two photos and asks
which was taken further north. A right pick keeps the second photo and deals a new one beside it;
the first wrong pick ends the run. Photos under one degree of latitude apart count either way. The
reveal names both places with their latitudes and says whether Atlas, going by its own guesses,
would have got the pair; your best streak is kept in your browser. **Today's run** (at
`/further-north/daily`) deals everyone the same order on the same UTC day: one try a day, picked
back up where you left it after a reload, with a spoiler-free share line (counts only) at the end. After a free run, *Challenge a friend* sends a link to the very
photos you were shown, in the same order, with your run to beat; on the pair that ended your run the
friend sees which photo you picked, and a friend who gets past it plays on through the rest of the
deck and can send theirs back.
**Odd one out** (at `/odd-one-out`, linked from the results screen) deals four photos, three
taken on one continent and one on another; tap the odd one (keys 1 to 4 on a keyboard). A right
tap deals four more, the first miss ends the run, and your best run is kept in your browser. The
reveal names every photo's continent and place, and what Atlas would have picked from its own
guesses: the one photo it placed on a different continent, or else its pin furthest from the rest.
**Today's run** (at `/odd-one-out/daily`) deals everyone the same quads on the same UTC day, one
try a day, resumed after a reload and shared as counts only. After a free run, *Challenge a friend* sends a
link to the very quads you were shown, each photo in the same place, with your run to beat; on
the quad that ended your run the friend sees which photo you tapped, and a friend who gets past it
plays on through fresh quads and can send theirs back.
**How far apart?** (at `/how-far`, in the Games menu) shows two photos and a slider on a log scale
from 10 km to 20,000 km: set how far apart you think they were taken. Each of the five pairs scores
up to 1,000 points by how many times off you were (all of them when exact, none from 10× off), and
the deal mixes pairs from one continent with pairs from two, so the whole slider matters. The
reveal places the truth, your estimate and Atlas's (the distance between its own two guesses) on
the scale; your best game is kept in your browser.
**Today's game** (at `/how-far/daily`) deals everyone the same five pairs on the same UTC day, one
try a day, picked back up at the next pair after a reload and shared as each pair's points in
coloured squares with the total.
After a free game, *Challenge a friend* sends a link to the same five pairs with where you set the
slider on each; the friend sees your estimate on the scale only once theirs is locked in, scored
against the same true distance, and can send theirs back.
**Which way?** (at `/which-way`, in the Games menu) shows where you stand and where you're headed:
pick which of eight compass points you'd set off in, by the great-circle starting bearing (the
heading of the shortest route, so Paris to Tokyo sets off north-east, not east). The reveal draws
the route on the globe with its bearing and distance, says when a flat map would have misled you,
and shows Atlas's pick from its own two guesses; a heading within 5° of the line between two points
counts for either. A right pick travels on, where you were headed becoming where you stand; the
first miss ends the run, and your best run is kept in your browser. Keys 1 to 9 pick on a number
pad's layout (8 is north).
**Today's run** (at `/which-way/daily`) sets everyone off on the same journey on the same UTC day,
one try a day, picked back up at the photo you stood at after a reload and shared as counts only.
After a free run, *Challenge a friend* sends a link to the same journey, stop by stop, with your
run to beat; on the stop that ended your run the friend sees, once they've picked, which way you set
off, and a friend who gets past it travels on through the rest of the deck and can send theirs back.
**Hot and cold** (at `/hot-cold`, in the Games menu) gives you three pins to find each photo's
country. A pin that misses says how far off it was and points an arrow the way to head from it,
without naming the place, and the second miss says warmer or colder; earlier pins stay numbered on
the globe. A photo scores your closest pin on the usual curve, plus 1,000 points for finding the
country on the first pin or 500 on the second. Five photos a game, against Atlas's single pin
scored by the same rules; your best game is kept in your browser. **Today's game** (at
`/hot-cold/daily`) deals everyone the same five photos on the same UTC day, one try a day. Every pin
is kept as it drops, so a reload picks up where you were and can't take back a miss, and the share
shows each photo's pins, spoiling no place. After a free game, *Challenge a friend* sends a link that deals the
same five photos in the same order, with your points and the pin that found each country shown
after every photo and the total to beat in the header; it carries ids and numbers only.
**Name the country** (at `/name-country`, in the Games menu) shows one photo and four countries from
the same continent, drawn from the countries the globe draws: tap the right one, or press 1 to 4,
and go on until your first miss. Atlas picks too, the name it gave the most of the four, and the
reveal names the place and its continent. Your best run is kept in your browser. **Today's run**
(at `/name-country/daily`) deals everyone the same photos and names on the same UTC day, one try a
day, resumed after a reload and shared as counts only. After a free run, *Challenge a friend*
sends a link to the very photos you were shown, with the same four names on each and your streak
to beat; a friend who gets past your miss plays on through photos you never saw, and can send
theirs back.
**Line them up** (at `/line-up`, in the Games menu) deals four photos, each from its own continent
where it can, to put in order from west to east as on a flat world map from the date line: tap two
to swap them, drag one into place, or press their numbers, and open any photo to look closer. A
point for each photo in its place, with photos within 2° of longitude counted as level, over five
rows against the order of Atlas's own pins; the reveal stands the row in its true order with every
longitude. Your best game is kept in your browser. Today's rows (`/line-up/daily`) are the same for
everyone: one try a day, picked up at the next row after a reload, and shared as squares and counts.
After a free game, *Challenge a friend* sends a link that deals the very same rows, each opening in
the very order it opened for you, carrying how many you had in place on each and nothing else: the
friend sees the count to beat, yours on every row, and can send theirs back.
**Close-up** (at `/close-up`, in the Games menu) opens on a tight crop of a photo, its busiest
corner where the photo can be read, with four countries from the same continent. Each wrong name
zooms out and costs a point: three on the tightest crop, then two, then one, and none after a third
wrong name. The answer shows the whole photo. Five photos a game; Atlas sees each whole photo and
scores by how far down its own list of the four the answer stands, and your best game is kept in
your browser. Today's photos (`/close-up/daily`) and their names are the same for everyone: one try
a day, a wrong name kept as it is tapped so a reload opens on the same wider crop, and shared as
squares for the tries on each photo. After a free game, *Challenge a friend* sends a link that deals the
very same five crops and names, carrying your points on each and nothing else: the friend sees the
points to beat, yours beside theirs on every photo, and can send theirs back.
**Left or right?** (at `/left-right`, in the Games menu) shows one photo and asks which side of the
road they drive on where it was taken: tap *Left* or *Right*, swipe the photo to a side, or press
← or →. The answer names the country and its side, and Atlas calls each photo too, from its road
clue or else the side of the country it picked. Left and right photos are dealt by a fair coin, not
in the catalog's proportions (most photos are from right-hand-traffic countries), so always
calling one side is a coin flip. Endless until the first miss; your best run is kept in your browser.
**Today's run** (at `/left-right/daily`) deals everyone the same photos on the same UTC day with the
same even deal, one try a day, picked up after a reload and shared as counts only. After a free run,
*Challenge a friend* sends a link naming the photos you were shown and your run to beat: the friend
plays them in the same order, sees which side you called on the photo that ended your run once
they've called it, plays on past it through the photos left, and can send theirs back with a
head-to-head picture.
**Which climate?** (at `/which-climate`, in the Games menu) shows one photo and the five Köppen
climate groups: tropical, arid, temperate, continental and polar. Tap one or press 1 to 5. The
answer lights the place's own group on a band of all five, with your call and Atlas's marked on it,
says what the group means and how far from the equator the place sits. Atlas plays from its own
climate clue, and scores nothing on a photo it said nothing about. Each photo's group is drawn by a
fair die over the groups, not in the catalog's proportions, so always naming one group scores about
a fifth. Five photos a game; your best game is kept in your browser.
**Today** (at `/today`, in the Games menu and on the results screen) puts every daily game on one
page: the Daily Five, Further North, Odd one out, Which way?, How far apart?, Name the country,
Hot and cold, Line them up, Close-up and Left or right?, each with where it stands in your browser (not started, under way or its result), the time to the next deal, and one
share line gathering every finished game, as scores and counts only. **Atlas's day** sets you
against Atlas on each finished game it played all the way through, game by game, and says who took
the day, a line the share carries too. Below them, **Full days**
counts your run of days with every daily game finished and shows the last four weeks as a calendar.
**Stamps** (at `/stamps`, from Today and the results screen) collects what you've played in this
browser: the record's badges, a continent cleared once you've pinned a photo from every country the
game has there, a full day and a full week of daily games, and one for beating Atlas at each daily
game (on a day it played every photo you did). Each says how it's earned and how close you are (for
Atlas, your nearest miss on the days kept), the one nearest to done is named next, and a stamp once
collected stays.

The results screen gathers these quick games (Blitz, Country Streak, Survival, Further North, Odd
one out, How far apart? and Which way?) in one list, each with your best from this browser beside its name, so you see what
to beat before you open one; Blitz starts straight from its card. The same list, with the
five-round game and pass and play, opens from the **Games** button in the header of round one
and of every quick game, so each way to play is one tap away before you've finished a game.
**Pass and play** (at `/pass-and-play`, linked from the results screen) is for two to four players
on one phone or laptop: each pins the same photo in turn behind a "Pass to …" screen that hides the
last pin, then one reveal shows every numbered pin, Atlas's, and the running table. Five photos a
game, the first turn moves one seat along each round, and the names are kept for the next game.
**Your map** (at `/map`) puts every photo you've played on one globe, each mark shaped and
coloured by how close your pin landed (a circle, diamond, triangle or cross, so it reads without
colour vision too), with the countries and continents you've seen counted and your rounds
listed newest first; pick one to fly the globe to it. **Your closest calls** sit under the globe:
the five rounds where your pin landed nearest, each with its photo, your distance, Atlas's on the
same photo and a link to a game on that continent. **Your continents** come next: how far off
your pins land on each continent, by the median of your rounds there so one wild miss doesn't
swamp it, with how many landed within 500 km and, after ten pinned rounds, whether your last five
are closer than the five before. Once two continents have five pinned rounds each, the furthest
is your weak spot, with *Practise* to deal a five-photo game there. **Getting closer** charts
your form over time: a column per week, as tall as the median distance your pins landed off that
week, with how the newest week compares with the one before; tap a week for its rounds. It waits
until two weeks have pinned rounds. **Countries you mix up** lists the pairs you've most often
taken for each other in Name the country, Close-up and Country Streak (from your last 300 wrong
answers), how often and which way round, with a Country Streak on that continent to practise
them. Once those countries have three photos to deal, *Practise your mix-ups* opens Name the
country on just them (`/name-country/mix-ups`): every photo offers the country you took it for
among its four names, the countries take turns so a big one never crowds out its partner, and the
run keeps its own best. Below them, **your clue reading**: how often you've read the road in
Left or right? and the climate in Which climate?, in photos called right, beside Atlas's own read
of the same photos (it sits out a photo it said nothing about), with today's Left or right? runs
counted in. Then **you and Atlas in the quick
games**: for Further North and Odd one out, the rounds you got right of those you answered beside
the rounds Atlas got right of those it played, free runs and today's runs together, and who is
ahead. Then **head to head with friends**: every friend's challenge you've answered from a link,
in any game, won, lost or tied, grouped by game with each result in its own units, a link to
play theirs again and *Send a rematch*, which sends your result on it back. It is kept only in
your browser.
**Rematch Atlas** appears on the results once Atlas has beaten you on five photos the first
time you played them: it deals the five it beat you by the most and shows your first try on each
to beat. A photo leaves the rematch once you outscore Atlas on it, in any game.
**Install it** from your browser's menu ("Add to Home screen" or "Install app") to play it like
an app. A game keeps all five photos on your device as soon as it deals them, so it plays on if
your connection drops, even if you reload the page.
**Pick up where you left off**: a game in progress is kept in your browser after every move, so a
reload or your phone closing the tab reopens it on the same round, with the same photos, score,
pin and hints (and, in Blitz, the same time left on the clock).
**Feel the reveal**: on phones that support it, a short buzz and a soft chime greet each answer,
bigger and brighter the closer your pin landed. The speaker button in the header mutes both
(remembered in your browser), and with reduced motion turned on in your system neither ever plays.

## What's interesting about it

| Area | What it does | Where |
| --- | --- | --- |
| **Atlas v0** | Hierarchical zero-shot CLIP geolocation: country by prompt-ensembled softmax, then city within the top countries, P(city) = P(country) × P(city \| country), over GeoNames. Clues ("Snow and ice 81%") come from zero-shot concept groups and only show when one option clearly wins. | [`ml/`](ml/) |
| **Clue heads** | Logistic-regression probes on frozen CLIP embeddings read the driving side and the Köppen climate group, trained on reference photos labelled from maps by their coordinates. Each game photo is scored by a probe that never saw its 10° block, against today's source of that clue (the zero-shot climate clue; the driving side of Atlas's guessed country), and a probe writes its clue at the reveal only if a paired bootstrap puts the accuracy gain above zero. | [`ml/src/whereabout_ml/clue_heads.py`](ml/src/whereabout_ml/clue_heads.py) |
| **Where Atlas looked** | Occlusion saliency: grey out each cell of a 7×7 grid over the square CLIP sees and measure how much Atlas's belief in its country falls. A deletion test (hide the top 5 cells vs 5 random ones) checks that the maps are faithful rather than decorative. The heatmap glows in the reveal card. | [`ml/src/whereabout_ml/saliency.py`](ml/src/whereabout_ml/saliency.py) |
| **Pocket Atlas** | *Test Atlas on your own photo* with no server: every country, city and clue prompt is embedded once offline and shipped as int8 vectors (a few MB); CLIP's image encoder runs in the browser via transformers.js; the country-then-city math is a TypeScript port pinned to the Python reference by a shared fixture. A real-Chromium test checks the browser's embedding against PyTorch's before the index ships (it caught four mismatches: an 8-bit browser model, photos read without their EXIF orientation, open_clip running OpenAI's weights without QuickGELU, and a canvas resize that barely antialiased big photos; the browser now computes CLIP's input with a byte-exact port of Pillow's bicubic resample, `preprocess.ts`). A privacy gate runs first: the scene gate's people and indoor checks, recalibrated for the browser's model, decline a photo of people or of a room before Atlas guesses. When you show it where the photo was, the globe shades every country by how sure it was, the same heatmap as the game's reveal (`belief.py` and its port in `belief.ts`). On request, *Where did Atlas look?* runs occlusion saliency in the browser: each of 49 patches is greyed out in CLIP's pixels and re-embedded, and the deletion test (hide the top 5 patches vs. 5 random ones) checks the map on your photo; `saliency.ts` is pinned to `saliency.py` by `data/fixtures/saliency_cases.json`. Your photo never leaves your device. | [`ml/src/whereabout_ml/pocket_index.py`](ml/src/whereabout_ml/pocket_index.py), [`web/src/lib/pocket/`](web/src/lib/pocket/) |
| **Evaluation** | Accuracy at 1 / 25 / 200 / 750 / 2,500 km, median error with bootstrap CIs, a paired bootstrap to test whether one system really beats another, a country-only ablation and two baselines. All scored with the same haversine that scores players. | [`eval/`](eval/), [`eval/results/`](eval/results/) |
| **Cold-path inference** | The model runs once, in GitHub Actions, over the catalog. The game ships its answers, so no visit ever waits on a model and hosting costs nothing. | [`.github/workflows/atlas.yml`](.github/workflows/atlas.yml) |
| **The reveal** | Great-circle arcs that cross the antimeridian correctly, a camera that fits its zoom to the visible frame (each zoom level halves the planet's span) and pads around the result card, reduced-motion support. Below Atlas's reasoning, *the real clues* (driving side, Köppen climate group, ESA WorldCover land cover at the spot) sit next to what Atlas read, each marked right or wrong; land cover is judged only where Atlas's scene clue and the map settle whether the spot is built up. Under the place name, the photo's *postcard*: its Commons description and a Wikipedia link. After a miss of more than 2,000 km into another country, *Tell them apart* gives one clue that separates the two (the side of the road, else the continent), read from the same tables as the real clues and the globe's own country shapes, and nothing when they share both. | [`web/src/lib/reveal.ts`](web/src/lib/reveal.ts), [`web/src/lib/trueClues.ts`](web/src/lib/trueClues.ts), [`web/src/lib/missLesson.ts`](web/src/lib/missLesson.ts) |
| **Atlas's verdict line** | At every reveal Atlas says one or two sentences in its own voice: how sure it was of its top country and whether that was right ("I was 81% sure of France. It was Belgium."), then who got closer and by how far, in the player's units, with a near-thing line under 50 km and a line for a closer pin that lost on points to its hints. Every number comes from the round itself (the reveal's percent, both distances, their difference); points decide the winner as on the card, and the phrasing is picked from the photo id so a replayed round reads the same. Phones show the outcome half alone, so the card still leaves most of the screen to the globe. A seeded test runs 400 random rounds in both units and checks every number in every phrasing against that round's own. | [`web/src/lib/atlasVoice.ts`](web/src/lib/atlasVoice.ts) |
| **The game in one picture** | The summary opens on a globe that flies from round to round, drawing your arc and Atlas's as it lands and dropping a numbered gold pin on each answer, then pulls back to all five at once. The whole-game camera centres on the mean of every point as a 3D unit vector (so a game spanning Fiji and Samoa centres on the Pacific, not Greenwich) and zooms on the reveal's curve to the furthest point. The tour is a small pure state machine (advance, show a round, replay), unit-tested apart from MapLibre; reduced motion and coming back from a replayed round open straight on the whole game. | [`web/src/lib/gameTour.ts`](web/src/lib/gameTour.ts) |
| **One definition of distance** | The browser and the server score with separate code (TypeScript and Python), so a shared fixture pins them together: both test suites check the same 10 cases. | [`data/fixtures/geo_cases.json`](data/fixtures/geo_cases.json) |
| **Spoiler-free share card** | The summary previews exactly what will be sent: a distance band per round, who got closer to each photo (you or Atlas), the score and hints taken, then the Web Share sheet where the browser has one, else the clipboard. The card is built only from numbers and fixed words, and a test plays every catalog photo through it to check the text never changes with the photos, so it can't leak a place. *Share as a picture* draws the same card on a 1080 px square canvas (tiles coloured by band and marked with the band's shape, who got closer under each, words instead of emoji so every phone shows the same thing) and hands the PNG to the share sheet where it accepts files, else saves it as a download; the same catalog-wide test covers every word it draws. A *Squares* switch beside the preview and under every daily's share button picks the text's emoji: classic (🟩 🟨 🟧 🟥) or colour-blind safe (🟦 🟨 🟧 🟥), since 🟩 and 🟥 nearly meet without red-green vision. Every game's share line is built in the classic set and swapped into the player's set as it is sent, the choice kept in the browser, and a unit test holds the safe set's squares (Twemoji's fills) apart under simulated protanopia, deuteranopia and tritanopia. | [`web/src/lib/share.ts`](web/src/lib/share.ts), [`web/src/lib/shareImage.ts`](web/src/lib/shareImage.ts), [`web/src/lib/squares.ts`](web/src/lib/squares.ts) |
| **Light or dark** | The site follows the device's light or dark setting, and *Colours* at the foot of the Games menu holds one (Auto, Light, Dark), kept in the browser and applied by a `<head>` script before the first paint, so a reload never flashes the other theme. The night chart's eight colour tokens get a daylight set where every text pairing keeps 4.5:1 (checked in a unit test), and the axe audit runs every screen in both themes. On a light page the game's globe is a daylight chart, repainted in place if the theme changes mid-game, with its pins, arcs and marks kept at 3:1 against sea and land and apart under simulated colour blindness (unit-tested); Your map and the results tour follow it too, Your map's closeness marks in their own daylight set; the globe stages' panels and the photo tiles keep the night chart for now. | [`web/src/lib/theme.ts`](web/src/lib/theme.ts), [`web/src/lib/basemap.ts`](web/src/lib/basemap.ts), [`web/src/app/globals.css`](web/src/app/globals.css) |
| **Your record against Atlas** | Games played, rounds won against Atlas, best game, Daily Five streak and rounds won by continent (with the continent you beat Atlas on most and least, once two have three rounds each), kept only in your browser with a confirm-to-reset button. Streaks count Daily Five *puzzle days* (UTC) rather than local dates, so time zones and daylight-saving changes never break one; tests pin that down in Los Angeles, Tokyo and across the October clock change. A stored record is validated on read, and a corrupt one starts over instead of crashing (a record saved before continents were kept just starts their tally). | [`web/src/lib/playerRecord.ts`](web/src/lib/playerRecord.ts) |
| **Country Streak** | Name the country by tapping it on the same Natural Earth shapes the globe draws: an even-odd point-in-polygon test, with rings that cross the antimeridian (mainland Russia, Fiji) unwrapped first so they don't swallow the rest of the world, and Antarctica closed along the pole. Only photos whose country the globe draws are dealt, so every answer can be tapped. The rules are a pure reducer (a sea tap is no answer, the first miss ends the run); a browser test walks the keyboard pin into the right country twice, then a wrong one. A run can be dealt from one continent's tappable photos (`streakRegions`, offered only with a game's worth), with a best kept per continent under its own key so a European run never moves the best from anywhere. | [`web/src/lib/countryHit.ts`](web/src/lib/countryHit.ts), [`web/src/lib/game/streak.ts`](web/src/lib/game/streak.ts) |
| **Daily Five archive** | Each day's five photos come from a seeded shuffle keyed on the UTC date, so any past day can be dealt again with no server: `?daily=YYYY-MM-DD` plays any of the last 30, and a calendar on the results screen shows the first score this browser kept for each day. A past day joins the record but never the streak (the mode carries an `archive` flag that the record and the resume rules both read), so a missed day can't be backfilled; a date ahead of today or out of the window falls back to today's with a one-line reason, and is validated as a real calendar day (`2026-02-30` is not one). | [`web/src/lib/game/dailyArchive.ts`](web/src/lib/game/dailyArchive.ts) |
| **Badges** | Five milestones on the summary: a first round won against Atlas, a pin within 25 km, a five-day Daily Five streak, a photo from every inhabited continent and a Hard game won against Atlas. Each is earned only by play: three follow from the record's own totals (so records kept before badges existed get them back), and two are noted from the game that earned them. The ones a game earned are marked new, the rest say how to earn them, and none is ever taken away. | [`web/src/lib/badges.ts`](web/src/lib/badges.ts) |
| **Look again at any round** | From the results, any round opens again on the game stage: its photo, both pins and the arcs, with no new score, stepping between rounds. The finished game's state is reused rather than replayed, so nothing is scored or recorded twice, and one history entry lets a phone's back gesture return to the results. | [`web/src/components/Game.tsx`](web/src/components/Game.tsx), [`web/src/components/RevealCard.tsx`](web/src/components/RevealCard.tsx) |
| **Challenge a friend** | The whole challenge lives in the link, `?challenge=<five photo ids>_<five scores>`: no server, no account, nothing stored. It carries ids and points only, never a place or a coordinate, so it spoils nothing (a test runs a game's places against the message). A link is played only if it names five different photos this build can deal and five whole scores from 0 to 5,000; a cut-short link or one whose photos have left the catalog gets a fresh game and a one-line reason. The friend sees your points on each photo at the reveal and the outcome at the results; scores are whatever the link says, which suits a friendly game, not a leaderboard. | [`web/src/lib/game/challenge.ts`](web/src/lib/game/challenge.ts) |
| **Continent games** | Each playable photo's catalog country maps to one of seven continents (the same table the results page groups Atlas's errors by), rebuilt at every build so each harvest grows the pools. A continent is offered only when it can fill a game, in the same menu as the difficulty tiers so a phone's header stays one row; a browser test checks every photo a Europe game fetches was taken in Europe. | [`web/src/lib/game/regions.ts`](web/src/lib/game/regions.ts) |
| **Difficulty from the model's own errors** | Easy, Medium and Hard are the thirds of the catalog by how far Atlas v0's guess landed from each photo, recomputed at every build, so tiers follow each Atlas run and harvest with no hand labelling. The header states each tier's real cut points ("Atlas missed these by … km or more", from the current data); photos Atlas sat out join no tier, and tiers only appear when every third can fill a game. A browser test measures Atlas's errors independently and checks a Hard game deals only Hard photos. | [`web/src/lib/game/tiers.ts`](web/src/lib/game/tiers.ts) |
| **Hints for points** | Up to three clues per round, broadest first: the continent, the side of the road traffic drives on, then the climate group, from concept labels read off real climate and land-cover maps. Each one lowers the round's maximum by 1,000 points. On the API the server hands out the hints and counts them, so a guess can't claim fewer; the static game builds the same clues in the same words, and a shared fixture pins both scorers together. | [`api/src/whereabout_api/hints.py`](api/src/whereabout_api/hints.py), [`web/src/lib/hints.ts`](web/src/lib/hints.ts), [`data/fixtures/hint_cases.json`](data/fixtures/hint_cases.json) |
| **Game engine** | A pure reducer drives the game, with two interchangeable backends: the FastAPI server (answers stay server-side until you guess, and it scores Atlas's guess too) or the static catalog (a free static site that fetches only the five photos each game deals, so the page stays small as the catalog grows). | [`web/src/lib/game/`](web/src/lib/game/) |
| **Resume after a reload** | The game in progress (its five photo ids, every scored round and the round on screen: pin, hints taken, Blitz time left) is written to `localStorage` after every move and on `pagehide`, and read back through a field-by-field validator, so a save from an older build, a deck that dropped a photo or a hand-edited score starts a new game instead of crashing. Resuming replays the reducer's own `resumed` action and re-takes the hints through the backend, so a reload can't buy back a hint's cost or a Blitz round's seconds. The plain address reopens whatever was left; an address asking for another game starts that one; a Daily Five only resumes on its day. | [`web/src/lib/game/saved.ts`](web/src/lib/game/saved.ts) |
| **Your map** | Each revealed round adds the photo's id, true location, distance and score to a history in `localStorage`: one entry per photo (a replay replaces it and moves to the newest end), capped at 400. It is read back through a validator that drops a malformed entry on its own, so one bad row never costs the rest. The page draws the history as one GeoJSON symbol layer on the same MapLibre globe, a `match` expression on the reveal's distance bands (25 / 500 / 2,000 km) picking each band's shape, rasterised in plain JavaScript from the same geometry the legend's SVG and the share picture's canvas draw ([`web/src/lib/closenessMarks.ts`](web/src/lib/closenessMarks.ts)); both closeness palettes are held by unit tests to stay apart under simulated protanopia, deuteranopia and tritanopia ([`web/src/lib/colorVision.ts`](web/src/lib/colorVision.ts), Machado et al. 2009 measured in OKLab), and counts countries and continents from each answer's ISO code. Its closest calls are the five pinned entries nearest the answer (ties to the higher score, then the newer round); the page fetches only those five photos' static records, one request each so a dropped photo or a failed fetch costs one card its photo and Atlas line, and measures Atlas's guess to the same stored answer. Atlas's quick-game record, and your clue reading beside it, add two sources per game without counting a round twice: free runs of Further North, Odd one out, Left or right? (challenges included) and Which climate? tally each answered round as it happens (rounds, right, rounds Atlas played and got right, runs) under one key, and today's runs are read back from the per-day results those screens already keep (a day's streak is its right rounds, a miss one round more); each side's rate is over its own rounds, since Atlas sits out a round it never guessed a photo of (in the clue games, a photo it gave no read of the road or the climate on). The head to head with friends is written as each friend's challenge ends, from the same `HeadToHead` its picture is drawn from (`useKeepChallenge`, shared by every game's *Share head to head*), so the list and the picture always agree: one entry per answered link (answering it again replaces it), keeping the game, the outcome, both totals in the game's words, the link as a same-site path and query, and the reply message as the rematch; capped at 60 and read back through a validator that drops a malformed entry or any link off the site. | [`web/src/lib/challengeLog.ts`](web/src/lib/challengeLog.ts), [`web/src/lib/game/quickRecord.ts`](web/src/lib/game/quickRecord.ts), [`web/src/lib/playedMap.ts`](web/src/lib/playedMap.ts), [`web/src/components/PlayedMap.tsx`](web/src/components/PlayedMap.tsx), [`web/src/lib/closestCalls.ts`](web/src/lib/closestCalls.ts) |
| **Rematch Atlas** | A revealed round joins a small pool in `localStorage` only when it was your first try at that photo (the photo was not yet on your map) and Atlas outscored you; it keeps your points and Atlas's. Beating Atlas's points on that photo later, in any mode, removes it, and losing again never lowers the bar. The summary offers a rematch once five pooled photos are still in the deck, picked by Atlas's margin (ties by id, so the same pool deals the same game). A rematch is a browser-dealt mode carrying the same ids-and-scores shape as a challenge, so a reload resumes it through the same saved-game validator. | [`web/src/lib/game/rematch.ts`](web/src/lib/game/rematch.ts) |
| **Feel without files** | The reveal's chime is a few sine notes synthesised with the Web Audio API (a C-major arpeggio that climbs higher, and a buzz from `navigator.vibrate` that runs longer, the closer the pin: within 25 km, the Bullseye badge's bar, then 500 km, then 2,000 km), so there are no sound files to download, cache or license. Browsers only allow sound after a tap, so the player's own taps and key presses wake the audio, which lets a Blitz time-out chime too. The bands, patterns and the mute/reduced-motion rules are pure and unit-tested; a Playwright test records the buzz and the notes played. | [`web/src/lib/feel.ts`](web/src/lib/feel.ts) |
| **Miles or kilometres** | Every distance a player reads (the reveal, the results, your map, the share picture's legend) follows the browser's language region on a first visit: miles where road signs use them (the US and its territories, the UK, Liberia, Myanmar), kilometres everywhere else, read with `Intl.Locale`. A *km \| mi* switch on the reveal, the results and the map flips them all at once through `useSyncExternalStore`, follows a change made in another tab, and is remembered in the browser. Scoring, bands and everything stored stay in kilometres; only the words change, and the Atlas research page keeps kilometres, the unit its benchmarks use. | [`web/src/lib/units.ts`](web/src/lib/units.ts), [`web/src/lib/useUnits.ts`](web/src/lib/useUnits.ts) |
| **Plays offline** | A web app manifest (with a maskable icon) makes the site installable, and a service worker built by esbuild after `next build` precaches the app shell: every page and script chunk the static export emits, the fonts and MapLibre's worker, under a cache named after a hash of those files. Once a game deals its five photos, the page hands their records and Wikimedia photos to the worker, so the rest of the game needs no connection; offline, a photo asked for at a width the device never kept is answered with the widest copy of the same file. The rules are pure functions with unit tests; a Playwright test plays a round, cuts the connection for the page *and* the worker, reloads, and finishes the game. | [`web/src/lib/offline/`](web/src/lib/offline/), [`web/src/sw/sw.ts`](web/src/sw/sw.ts) |
| **First photo first** | The round's photo is the screen, so it gets the connection: as soon as the five records arrive the game preloads the first photo with the same candidates and `sizes` as its `<img>` (so a phone fetches the one width it will show, once) at high fetch priority, and the globe's library, about a megabyte of MapLibre, waits until that photo is on screen (or six seconds, whichever is first). An end-to-end test plays the home page on an emulated Pixel 7 over a 1.6 Mbit/s, 150 ms line and checks the order; on one 2-core run here the photo was on screen at 7.6 s, against 9.2 s with the globe loading alongside it. | [`web/e2e/first-photo.spec.ts`](web/e2e/first-photo.spec.ts), [`web/src/lib/photoSources.ts`](web/src/lib/photoSources.ts) |
| **Accessibility** | The whole game can be played with the keyboard, and an end-to-end test does exactly that. Press `?` (or tap the ? button on a phone) for a sheet of every control on the screen in view: keys and clicks on a desktop, gestures on a touch screen, from one list that an end-to-end test presses key by key. In a round, H takes a hint and G guesses. Type is Atkinson Hyperlegible; results are announced to screen readers. Every page's first screen, a whole game (round, hint, help sheet, Games menu, reveal, results, then Your map, Today and Stamps with the game kept) and each quick game's first reveal are checked by axe-core against WCAG 2.2 A and AA on a desktop and a phone, and any problem fails the build: so every button's spoken name starts with the words on it, for voice control ("Hint −1,000", "km", "NW"), and every link is at least 24 px tall. | [`web/src/lib/controls.ts`](web/src/lib/controls.ts), [`web/e2e/a11y.spec.ts`](web/e2e/a11y.spec.ts) |
| **Open data** | 88 photos from 54 countries, all openly licensed from Wikimedia Commons, reviewed by eye, credited after every round. | [`data/curation/`](data/curation/) |

## Atlas results

Zero-shot, on the 88 game photos (run of 2026-10-10, from
[`eval/results/atlas-v0.md`](eval/results/atlas-v0.md), which
[`.github/workflows/atlas.yml`](.github/workflows/atlas.yml) generates and commits):

| System | Within 25 km | Within 750 km | Country right | Median error (95% CI) | Mean score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Random city (baseline) | 0.0% | 1.1% | 2.3% | 7,836 km (7,081–8,722) | 268 |
| Best constant guess (baseline) | 1.1% | 3.4% | 2.3% | 6,470 km (4,467–7,355) | 591 |
| CLIP ViT-B/32 (LAION-2B), country then city | 9.1% | 27.3% | 27.3% | 2,593 km (1,633–4,098) | 1,739 |
| CLIP ViT-L/14 (OpenAI), country only | 6.8% | 42.0% | 43.2% | 1,156 km (701–2,823) | 2,149 |
| **CLIP ViT-L/14 (OpenAI), country then city** (plays in the game) | **13.6%** | **43.2%** | 42.0% | **949 km** (649–2,834) | **2,359** |

What the run shows:

- **Model size matters.** ViT-L/14 beats ViT-B/32 by 1,644 km of median error, and a paired
  bootstrap puts that difference clearly away from zero (95% CI −2,773 to −10 km).
- **The city step helps where it should.** It doubles city-level hits (6.8% → 13.6% within
  25 km), but its effect on median error is within noise (−207 km, CI −1,335 to 870).
- **Atlas has a geography.** Computed from the shipped guesses on the site's
  [How Atlas guesses](web/src/app/atlas/page.tsx) page: its median error is 166 km on the
  5 photos from Oceania but 7,075 km on the 8 from South America, where it never names the
  right country. Small groups, but a clear target for a trained Atlas.
- **Caveats.** 88 photos is small, and CLIP was pre-trained on web data that probably includes
  Wikimedia Commons, which may flatter these scores. Public benchmarks are next.

## How it fits together

```
 Browser (Next.js static export)                          GitHub Actions (offline, cold path)
 ┌─────────────────────────────────────────────┐          ┌─────────────────────────────────────┐
 │ Game: photo ─ globe (MapLibre, WebGL)       │          │ atlas.yml                           │
 │   game reducer ── LocalBackend (catalog) ◀──┼──────────┼─ atlas.json: guesses, clues,        │
 │        └──────── ApiBackend ──┐             │          │   "where Atlas looked" maps,        │
 │                               │             │          │   evaluation table                  │
 │ Your photo (Pocket Atlas)     │             │          │ eval/results/: metrics, deletion    │
 │   transformers.js CLIP ──┐    │             │          │   test, browser-vs-PyTorch parity   │
 │   locate.ts ◀────────────┴────┼─────────────┼──────────┼─ pocket-atlas/: int8 text index     │
 └───────────────────────────────┼─────────────┘          └─────────────────────────────────────┘
                                 ▼
                    FastAPI (rounds, server-side scoring of player and Atlas)
```

More in [`docs/architecture.md`](docs/architecture.md), design decisions in
[`docs/decisions/`](docs/decisions/), the visual system in [`docs/design.md`](docs/design.md).

## Run it

```bash
make web-install && make web-dev   # the game on http://localhost:3000
make install && make test          # Python: api, eval, ml
make web-test                      # web: lint, unit tests, build, bundle check, type-check
make web-e2e                       # real games in Chromium (npx playwright install chromium)
make api                           # the FastAPI backend on :8000 (docs at /docs)
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` to play against the API instead of the bundled
catalog, or run both with `docker compose up --build`.

Run Atlas yourself (downloads CLIP weights and the photos):

```bash
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e api -e eval -e "ml[clip]"
atlas-v0 --catalog data/curation/photos.csv --gazetteer data/geonames \
         --images .cache/images --atlas-out web/src/data/atlas.json \
         --results-dir eval/results --model ViT-B-32:laion2b_s34b_b79k
```

Image embeddings are cached per model, photo and image bytes in `.cache/embeddings`, so a rerun
only encodes new photos and its guesses match the first run's exactly. Saliency maps are cached
in `.cache/saliency`; `--saliency-budget-minutes N` stops starting new maps after N minutes (the
CI run uses 90 and queues another run for the photos still without one).

Atlas can also refine its pin by retrieval: within the country it chose, it moves the pin to
where the most similar geotagged reference photos were taken (never game photos; see
[`data/reference/`](data/reference/README.md) and
[decision 0005](docs/decisions/0005-retrieval-refinement.md)). The refined Atlas is scored next
to the others and plays only if a paired bootstrap shows it beats the unrefined one:

```bash
reference-set --gazetteer data/geonames --exclude data/curation/photos.csv \
    --exclude data/harvest/harvested.csv --out data/reference/references.csv \
    --images .cache/references --budget-minutes 30
atlas-v0 ... --references data/reference/references.csv --reference-images .cache/references
```

The same `--references` run also trains a geocell head: a linear classifier over adaptive
geocells on frozen CLIP embeddings of the reference photos, with haversine label smoothing
([decision 0007](docs/decisions/0007-geocell-head.md)). It is scored alone and as the pin within
Atlas's country, and places the pin in the game only if the paired bootstrap says it clearly
beats the playing Atlas. It takes a few minutes on a CPU runner.

With `--pocket-model` as well, a country head for Pocket Atlas is distilled from the playing
Atlas: trained on the browser model's embeddings of the reference photos to match the playing
model's calibrated country probabilities, as a correction to Pocket Atlas's own zero-shot logits
([decision 0008](docs/decisions/0008-distilled-country-head.md)). Its verdict against today's
Pocket Atlas goes to `eval/results/pocket-calibration.json`; `--distill-budget-minutes` caps how
long one run spends embedding the reference photos with the playing model.

Concept labels for the clue heads (driving side, climate, land cover) come from open maps by
coordinates; see [`data/maps/README.md`](data/maps/README.md) for the downloads and
`python -m pip install -e "ml[maps]"` for the GeoTIFF reader. The catalog's labels are made by
[`.github/workflows/labels.yml`](.github/workflows/labels.yml), which fetches the real maps,
checks known places against them and commits [`data/labels/`](data/labels/README.md); locally:

```bash
concept-labels --catalog data/curation/photos.csv --maps-dir data/maps \
    --known-places data/fixtures/concept_places.json \
    --out data/labels/concept_labels.csv --download \
    --references data/reference/references.csv \
    --references-out data/reference/concept_labels.csv
atlas-v0 ... --references data/reference/references.csv \
    --labels data/labels/concept_labels.csv --reference-labels data/reference/concept_labels.csv
```

The second half labels the reference photos too, and `atlas-v0` then fits and scores the clue
heads (`whereabout_ml.clue_heads`, [decision 0006](docs/decisions/0006-clue-heads.md)).

Training images come through an ingestion pipeline that captures each Commons file's license
and author from the Commons API, rejects anything outside CC0 / public domain / CC BY /
CC BY-SA, and flags near-duplicates with a 64-bit perceptual hash.
[`.github/workflows/ingest.yml`](.github/workflows/ingest.yml) runs it on the catalog's files
and commits [`data/ingest/`](data/ingest/README.md); locally (`ml[ingest]`):

```bash
ingest-commons --catalog data/curation/photos.csv --out-dir data/ingest --name sample
```

New game photos come from a harvester that searches Commons around GeoNames places in every
10° grid cell for community-assessed Quality and Featured images, runs them through the same
license and duplicate checks (against the catalog too) and the CLIP scene gate, names each
place from GeoNames and balances the result across the grid.
[`.github/workflows/harvest.yml`](.github/workflows/harvest.yml) runs it and commits
[`data/harvest/`](data/harvest/README.md) with every rejection and its reason, then adds every
new harvested photo to the catalog and starts the Atlas run; the game deals a new photo once
Atlas has guessed it. Locally (`ml[clip,ingest]` and the GeoNames files):

```bash
harvest-commons --gazetteer data/geonames --catalog data/curation/photos.csv \
    --thresholds data/scene_gate/thresholds.json --out-dir data/harvest --target 1000
merge-harvest --catalog data/curation/photos.csv --harvested data/harvest/harvested.csv
cd web && npm run catalog
```

Each catalog photo can carry a postcard for the reveal: the English description from its
Commons file page and an English Wikipedia article about what it depicts, found through its
structured data and kept only if the article's coordinates lie near the camera.
[`.github/workflows/postcards.yml`](.github/workflows/postcards.yml) fetches them and commits
[`data/postcards/`](data/postcards/README.md) with the site's catalog rebuilt; locally:

```bash
postcards --catalog data/curation/photos.csv --out data/postcards/postcards.csv
cd web && npm run catalog   # folds the postcards into src/data/photos.json
```

The reveal shows the postcard under the place: the description, credited to the photo's Commons
page (CC BY-SA 4.0), and a *Read about … on Wikipedia* link. On phones the description is cut to
one line with a *More* button, so the card still leaves the answer in view.

## Tests

Every push runs the Python suites, the web unit tests, a production build, a type-check, a
Docker smoke test of the API, and Playwright games on a desktop and a phone viewport, with an
axe-core accessibility check of every screen they reach (`web/e2e/a11y.spec.ts`).

## Honest limitations

- Atlas v0 is zero-shot. Its trained parts (the geocell head and the map-derived clue heads)
  are small classifiers on a frozen encoder, and each only plays where it clearly beats v0;
  fine-tuning the encoder needs a GPU.
- The photos come from Wikimedia Commons, which CLIP's web-scale pre-training probably saw.
  Scores on this set may be flattered; public benchmarks are next.
- In the static demo the answers ship in the page and image URLs contain file names. It's a
  casual daily puzzle; leaderboards and rooms will use the API, which keeps answers server-side.

## Roadmap

Day-by-day progress is tracked in [`docs/roadmap.md`](docs/roadmap.md).

## License

Code: MIT, see [LICENSE](LICENSE). Photos keep their own Creative Commons licenses and are
credited in the game and in [`data/curation/photos.csv`](data/curation/photos.csv). Country and
city data: [GeoNames](https://www.geonames.org/) (CC BY 4.0). Coastlines and borders:
[Natural Earth](https://www.naturalearthdata.com/) (public domain).
