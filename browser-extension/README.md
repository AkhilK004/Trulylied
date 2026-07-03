# TrulyLied Browser Extension

A one-click Chrome extension that lets you fact-check any page without copying URLs.

## Installation (Chrome/Edge/Brave)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select this `browser-extension/` folder
5. Pin the TrulyLied shield icon to your toolbar

## Usage

1. Navigate to any news article, YouTube video, or blog post
2. Click the **TrulyLied** icon in your toolbar
3. Press **"Fact-Check This Page"**
4. A new tab opens with the live TrulyLied analysis report

## Requirements

- The TrulyLied Go backend must be running on `http://localhost:8080`
- The Next.js frontend must be running on `http://localhost:3000`

## Icons

The `icons/` folder needs three PNG icon files:
- `icon16.png` (16×16)
- `icon48.png` (48×48)
- `icon128.png` (128×128)

You can generate these from any shield/checkmark SVG, or use a placeholder image temporarily.
