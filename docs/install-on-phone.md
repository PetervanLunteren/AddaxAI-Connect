# Install on phone

You can install AddaxAI Connect on your phone so it feels like a normal app. There is no app store version. Instead, your browser saves a shortcut to the home screen and opens the site in its own window without the browser address bar. Notifications, login, and everything else work the same as on the website.

This works on iPhone (Safari) and Android (Chrome). The look is close to a native app on both.

The app also points this out itself. After logging in, the sidebar has an **Install app** entry, and a small one-time hint appears in the corner. On Android and desktop that entry opens the install dialog directly, on iPhone and iPad it shows the same steps as below. Both disappear once the app runs installed.

<p>
<img class="screenshot" width="49%" alt="One-time install hint on the dashboard" src="https://github.com/user-attachments/assets/0017958d-ddf5-4155-b80f-346915d25cf2" />
<img class="screenshot" width="49%" alt="Install app entry in the sidebar" src="https://github.com/user-attachments/assets/c6152f5a-3d56-4cb2-bb00-331ce49887b7" />
</p>

## iPhone

1. Open `https://your-server-domain` in **Safari**. Other browsers like Chrome on iPhone will not give you the standalone window.
2. Tap the **Share** button at the bottom of the screen (the square with an arrow pointing up). On newer Safari versions it sits behind the **⋯** button at the bottom right.
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name and tap **Add**.

The icon appears on your home screen. Tap it and the site opens fullscreen, with no Safari address bar.

<p>
<img class="screenshot" width="49%" alt="Share option behind the kebab menu in Safari" src="https://github.com/user-attachments/assets/1354787f-35ea-4cc7-9b4f-8e4862fb2e9f" />
<img class="screenshot" width="49%" alt="Add to Home Screen in the share sheet" src="https://github.com/user-attachments/assets/435fdf8e-520f-4077-9453-9c8b81d3ca13" />
</p>
<p>
<img class="screenshot" width="49%" alt="Confirm the name and tap Add" src="https://github.com/user-attachments/assets/88c25630-6f7f-4278-89a9-f8b410169814" />
<img class="screenshot" width="49%" alt="AddaxAI icon on the home screen" src="https://github.com/user-attachments/assets/d7718a6d-f740-466e-831e-bbd517e06b4c" />
</p>

## Android

1. Open `https://your-server-domain` in **Chrome**.
2. Tap the **three-dot menu** in the top right.
3. Tap **Install app** if you see it. If not, tap **Add to Home screen** and choose **Install** in the popup.
4. Confirm and tap **Install** or **Add**.

The icon appears on your home screen and in your app drawer. Tap it and the site opens in its own window without the Chrome address bar.

If your Chrome version only shows **Add to Home screen** as a plain shortcut, the result is still usable but it will open inside Chrome with the address bar. Update Chrome to get the full standalone install.

<!-- screenshot: android-install-menu.png (Chrome menu with "Install app" visible) -->

## Desktop

The same works on a computer. Open the site in Chrome or Edge and click the small **install icon** at the right end of the address bar (a screen with a down arrow). The app opens in its own window and gets an icon in your dock or taskbar. Safari on Mac can do it too, via **File** and then **Add to Dock**.

## What to expect

The installed app behaves like a native app, not like a website in a browser.

- **Launch screen.** Opening the app shows a teal screen with the AddaxAI mark while it loads, instead of a white browser flash.
- **Fullscreen.** No address bar and no browser buttons. On iPhone the app extends behind the notch, and the status bar with the clock and battery sits on a teal strip that matches the app.
- **No accidental reloads.** Swiping down at the top of a page does not trigger the browser pull-to-refresh, so scrolling through images never reloads the app by accident.
- **Stable zoom.** Tapping a form field does not zoom the page in, and buttons respond to taps without the browser double-tap delay.

<p>
<img class="screenshot" width="49%" alt="Launch screen" src="https://github.com/user-attachments/assets/c08f0c21-7ce5-48ae-ae6e-165ad070565e" />
<img class="screenshot" width="49%" alt="Installed app open with teal status bar" src="https://github.com/user-attachments/assets/6591ecad-f8d0-4eab-ada3-e315c0367172" />
</p>

Small things are still the browser underneath. For example, images long-press to save like in Safari or Chrome, which is handy for sharing a nice capture.

## Sign in once

The first time you open the app, log in as usual. The login is remembered, so the next time you tap the icon it goes straight to the dashboard.

## Update

The app updates automatically. When you open it after a new release, it loads the latest version. There is nothing to update by hand.

The launch screen and icon are read once at install time. If those ever change on the server, remove the app from your home screen and add it again to pick up the new ones.

## Uninstall

- **iPhone:** long-press the icon and tap **Remove App** then **Delete from Home Screen**.
- **Android:** long-press the icon and drag it to **Uninstall**, or open the app drawer and uninstall it like any other app.
- **Desktop:** open the app, click the three-dot menu in its title bar, and choose **Uninstall**.

## For developers

The pieces that make this work live in the frontend service.

- `public/manifest.json` is the web app manifest (name, icons, `display: standalone`, theme color). Android builds its install banner, icon, and launch screen from this.
- `index.html` carries the iOS meta tags plus one `apple-touch-startup-image` link per device size, because iOS needs an exact-size launch image per device.
- `public/splash/` holds those launch images. They were generated from `public/icon-512.png` on the brand teal `#0b6065` with ImageMagick, at 30% of the short screen side, capped at 512 px:

```bash
cd services/frontend/public
magick -size 1179x2556 canvas:'#0b6065' \
  \( icon-512.png -resize 354x354 \) \
  -gravity center -composite -strip -colors 128 \
  PNG8:splash/splash-1179x2556.png
```

- `src/styles/index.css` handles the rest of the native feel, in the base layer. Overscroll behavior, tap highlight, the teal status bar strip (`body::before`), the 16 px input font size on touch devices, and the safe-area padding for the notch and home indicator.

There is deliberately no service worker. One existed and was removed because its precaching served stale versions after deploys. `public/sw.js` is a self-destructing worker that cleans up old installs and can be deleted after a few months.
