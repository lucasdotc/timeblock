# Timeblock

Timeblock turns a plain-English description of your week into a conflict-free, time-blocked schedule. Tell it something like "3 leetcode a day, gym twice a week, dentist Tuesday at 3pm" and it lays everything out for you. Your schedule stays in sync across a Windows desktop app and your phone, all on one account.

## Download for desktop (Windows)

Get the latest installer from the releases page:

https://github.com/lucasdotc/timeblock/releases/latest

Two formats are available on the release:

- the `.exe` setup file, the simplest option (about 2 MB)
- the `.msi`, for managed or silent installs

Run either one, then launch Timeblock from your Start menu. The first time you open it, Windows may show a SmartScreen notice because the app is not code-signed yet. Click "More info", then "Run anyway".

The desktop version is a native window and talks to the same backend as every other version, so nothing lives only on one machine.

## Use it on your phone with Expo Go

The phone version runs through Expo Go, so you can try it without a store install.

1. Install Expo Go on your phone, from the App Store on iOS or Google Play on Android. Timeblock targets Expo SDK 54, which current Expo Go supports.
2. Put the project on your computer:
   ```bash
   git clone https://github.com/lucasdotc/timeblock
   ```
3. Start the phone app:
   ```bash
   cd timeblock/mobile
   npm install
   npx expo start
   ```
4. Scan the QR code that appears in the terminal. On iOS, point the Camera app at it. On Android, use the scanner inside Expo Go.

Keep your phone and computer on the same Wi-Fi network. If they are on different networks, run `npx expo start --tunnel` instead.

## Getting started in the app

Create an account. On the sign-in screen, choose "Create an account", then enter an email and a password of at least six characters.

Tell the assistant what you want. The chat box understands everyday requests:

- Add habits: "read 20 minutes every day", "gym twice a week"
- Schedule one-off events: "dentist Tuesday at 3pm", "call the bank tomorrow"
- Change things: "move gym to 6pm", "make leetcode 45 minutes", "soccer every day now"
- Reorder a day: "do soccer after job applications but before the gym"
- Remove tasks: "delete yoga"

Timeblock fits everything into your open time, keeps your fixed hours clear, and asks for confirmation before it moves anything that is already on your calendar.

Set your fixed hours. Under Fixed hours, add the blocks that stay put, such as work, sleep, or classes. The scheduler always plans around them, and you can choose whether they appear on the calendar.

Review and adjust. The Calendar and Today views show your plan. Open any block to change its start and end time, mark it done, skip it, or find another slot. When you log how long a task actually took, Timeblock learns your pace and suggests better time estimates.

## How it works

Timeblock keeps language and logic separate. Claude reads what you type and turns it into a structured request. A deterministic scheduling engine then places each task into a legal open slot, reserves travel and focus buffers so nothing double-books, and reports anything that cannot fit instead of dropping it. The desktop app, the phone app, and the web build all share that engine and a Supabase backend, which is why one account keeps every device current.
