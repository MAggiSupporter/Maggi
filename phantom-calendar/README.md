# PHANTOM CALENDAR

**Your Google Calendar, styled like a Phantom Thieves heist.** Red, black and paper-white.
Ransom-note headlines. Every new event arrives as a calling card. When an event starts,
the screen yells **IT'S SHOWTIME!**

It's a real calendar too. Day, week, month and schedule views. Drag to create, move and
resize events. Repeating events, search, colours, notifications. And it's **two-way**:

- Change something in the app and it's saved to Google Calendar straight away.
- Change something in Google Calendar (on your phone, on the website, or when someone
  invites you) and it shows up in the app within 30 seconds. It also checks the moment
  you switch back to the tab.

![Week view](docs/week.jpg)

| Month | Calling card | Phone |
|---|---|---|
| ![Month view](docs/month.jpg) | ![A calling card for a new event](docs/calling-card.jpg) | ![On a phone](docs/phone.jpg) |

> Fan-made and unofficial. It isn't affiliated with ATLUS or SEGA, and it contains no game
> artwork. Every shape is drawn in code, and the fonts are free Google Fonts.

---

## Try it first (30 seconds, no setup)

1. Download **[apps-script/Index.html](apps-script/Index.html)**. On that page, click the
   **download** button (the ⬇ arrow at the top right of the file).
2. Double-click the downloaded file. It opens in your web browser in **demo mode**, with fake
   events saved only in that browser. Click around, drag things and break things.

---

## Link it to your Google Calendar (about 5 minutes)

It's free and there's nothing to install. The app runs inside **your own Google account**
using Google Apps Script, Google's free tool for small apps. You don't need API keys, a
server or a Google Cloud account.

You'll copy two files into Google, press a few buttons, and get a private link that only
you can open.

### Step 1: Create the project

1. Go to **<https://script.google.com>** and sign in with the Google account whose calendar
   you want.
2. Click **New project** (top left).
3. Click **Untitled project** at the top and rename it **Phantom Calendar**.

### Step 2: Paste the Google-side code (`Code.gs`)

1. The editor shows a file called **Code.gs** containing `function myFunction() {}`.
   Click inside it, press **Ctrl+A** (Mac: **⌘+A**), then **Delete**, so it's empty.
2. In a new tab, open **[apps-script/Code.gs](apps-script/Code.gs)** here on GitHub. Click the
   **Copy raw file** button at the top right of the file (it looks like two overlapping
   squares).
3. Go back to the Apps Script tab, click inside the empty Code.gs and paste (**Ctrl+V** /
   **⌘+V**).

### Step 3: Add the app itself (`Index.html`)

1. On the left, next to **Files**, click the **+**, then choose **HTML**.
2. Type **`Index`** and press Enter. Use a capital **I** and don't type `.html`, because the
   editor adds it for you.
3. The new file has some sample code in it. Select it all and delete it.
4. Open **[apps-script/Index.html](apps-script/Index.html)** here on GitHub, click **Copy raw
   file**, and paste it into the empty Index.html. It's a long file, which is normal.
5. Click the 💾 **Save** icon, or press **Ctrl+S** / **⌘+S**.

### Step 4: Turn on Google's calendar service

1. On the left, next to **Services**, click the **+**.
2. In the list, click **Google Calendar API**, then click **Add**. Leave the name as `Calendar`.

### Step 5: Deploy it

1. Click the blue **Deploy** button (top right), then **New deployment**.
2. Next to **Select type**, click the ⚙️ gear and choose **Web app**.
3. Fill in:
   - **Description:** anything, for example `v1`
   - **Execute as:** **Me**
   - **Who has access:** **Only myself**
4. Click **Deploy**.

### Step 6: Give it permission

1. Click **Authorize access** and choose your Google account.
2. Google warns **"Google hasn't verified this app"**. That's expected, because you just made
   the app yourself and it isn't published anywhere. Click **Advanced**, then **Go to Phantom
   Calendar (unsafe)**.
3. Click **Allow**. The app asks for two things: to see and edit your calendars (it's a
   calendar app, so it needs that), and to see your email address, which it shows in the
   side panel.

### Step 7: Open it

1. Google shows a **Web app** URL ending in `/exec`. Click **Copy**, paste it into your
   browser's address bar, and press Enter. 🎉
2. **Bookmark it.** That link *is* your app.
3. **On your phone:** open the same link in Chrome or Safari while you're signed in to the
   same Google account, then choose **Add to Home Screen**.

Only you can open the link. Anyone else who tries it gets a Google "access denied" page.

---

## What it does

| | |
|---|---|
| **Views** | Day, week, month and schedule. On a phone, the week view shows 3 days at a time. |
| **Create** | Click an empty slot to make a 1-hour event. Drag down across slots to make a longer one. In month view, click a day to make an all-day event. The big **CREATE** button opens the full editor. |
| **Change** | Drag an event to move it, or drag its bottom edge to change when it ends. Each change gives you an **UNDO** button. On a phone, press and hold an event, then drag it. |
| **Repeating events** | When you change one, you choose **just this event** or **all events in the series**. Moving a weekly event to another day updates the rule, so "weekly on Tuesday" becomes "weekly on Wednesday". |
| **Details** | Location (opens Google Maps), video call link, guests and who said yes, description with clickable links, notifications. |
| **Editor** | Title, dates and times, all day, repeat, location, details, calendar, colour, notification, busy/free. |
| **Palace Deadlines** | Tick **Palace Deadline** on an event (or put "deadline" or "due" in its title) and the side panel counts down the days. The flag is saved on the Google event itself. |
| **Confidants** | Your calendars, each with a tarot arcana and a **rank** based on how busy it is this month. Click one to hide or show it. Read-only calendars (like holidays) are marked. |
| **Search** | Searches your calendars from a year ago to two years ahead. |
| **Calling cards** | Every new event gets one. Tap anywhere and it gets out of your way. |
| **SHOWTIME** | A cut-in banner when an event starts while the app is open. |
| **Themes** | Joker (red), Skull (yellow), Panther (pink), Oracle (green), Velvet Room (blue and gold), Crow (light mode). |
| **Extras** | Sound effects made in code (no audio files), an optional weather icon on each day, a 12- or 24-hour clock, and your choice of Sunday, Monday or Saturday as the first day of the week. |

**Keyboard shortcuts:** `C` create, `T` today, `D` `W` `M` `A` day/week/month/schedule,
`J`/`K` or `←`/`→` next/previous, `/` search, `R` check Google now, `E` edit the open event,
`Del` delete it, `S` sound, `Esc` close, `?` show the list.

Settings live in **the Hideout** (⚙️, top right) and are saved to your Google account, so
your phone and computer match.

---

## Updating to a newer version

When `Index.html` or `Code.gs` changes here:

1. Paste the new file(s) over the old ones in the Apps Script editor, then click **Save**.
2. Click **Deploy → Manage deployments**. Select your deployment, click the ✏️ pencil, set
   **Version** to **New version**, then click **Deploy**.

Your link stays the same.

---

## If something goes wrong

- **A screen says "ONE MORE STEP".** The calendar service isn't on yet. Do
  [Step 4](#step-4-turn-on-googles-calendar-service), then **Deploy → Manage deployments**,
  click ✏️, set **Version** to **New version**, and click **Deploy**. Reload the page.
- **"Sorry, unable to open the file at this time"** or a blank page. This usually happens
  when you're signed in to **several Google accounts** at once, which is a known Google Apps
  Script problem. Open the link in a private/incognito window and sign in only to the account
  you used in Step 1.
- **"Script function not found: doGet".** Code.gs wasn't saved, or it was pasted into the
  wrong file. Redo Step 2, click Save, then publish a new version (see above).
- **"No HTML file named Index was found".** The HTML file has to be called exactly `Index`.
  Rename it from the ⋮ menu next to the file, then publish a new version.
- **Something you changed in Google Calendar hasn't appeared.** Press `R`, or click the
  **SYNCED** chip at the top. In the Hideout you can make it check every 15 seconds.
- **A calendar's events are missing.** Its card under **CONFIDANTS** is probably faded,
  which means hidden. Click the card to show it again.
- **Dragging doesn't work on some events.** You can only change events on calendars you're
  allowed to edit. Holiday calendars and events other people invited you to are read-only.
- **You want to remove the app's access.** Go to
  **<https://myaccount.google.com/permissions>** and remove **Phantom Calendar**. You can also
  just delete the project at script.google.com.

---

## Privacy

Everything stays between you and Google. The code that touches your calendar is
`Code.gs`, which you can read, and it runs inside your Google account. The app uses no
server of its own and has no tracking. The only other places it contacts are Google Fonts
(for the lettering) and, only if you turn weather on, Open-Meteo, which receives the city
name you type.

---

## For tinkerers

The app's source is in `src/`: `index.html`, `styles.css`, and `js/`. The JavaScript is split
into utilities, effects, the Google/demo connection, state and sync, views, dialogs and
start-up. `apps-script/Index.html` is built from it into one file:

```
node tools/build.mjs        # rebuild apps-script/Index.html after editing src/
npm install                 # once; then: npx playwright install chromium
npm test                    # end-to-end tests in a real browser (needs Node 18+)
```

If you use [clasp](https://github.com/google/clasp), `apps-script/` is a ready project folder:
its `appsscript.json` already turns on the Calendar service and sets up the web app.

`tests/google-path.test.js` runs the real `Code.gs` against a fake Google Calendar and
drives the real app in Chromium. It covers creating, moving, resizing, repeating events,
read-only calendars, error rollback, and changes made in Google showing up in the app.
`tests/demo.test.js` covers the rest, including phone touch gestures. You can pass it a
time zone, for example `node tests/demo.test.js Asia/Kolkata`.
