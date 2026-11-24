# PE-2 results (run 2026-11-24 by the orchestrator)

Environment: Windows 11 (10.0.26100), Electron 45.4.1, the repository's Electron binary, one display at scale factor 1.5. One process per case (scratchpad/probes/pe2). Tray and taskbar read by eye from screen captures (desktopCapturer); the tray icon sat in the overflow flyout (Windows 11 default for a new app) and was captured with the flyout opened by a click on its chevron.

## Alpha form of `nativeImage.createFromBitmap` (BGRA input, read back through `toPNG`, which is straight alpha)

| Input B,G,R,A | `toBitmap()` | PNG R,G,B,A | Reading |
|---|---|---|---|
| 40 40 40 80 | unchanged | 80 80 80 80 | input is taken as PREMULTIPLIED: grey 0x40 at alpha 0x80 un-premultiplies to 0x80 |
| FF FF FF 80 | unchanged | FF FF FF 80 | invalid premultiplied (colour > alpha) is clamped, not rejected |
| FF 00 00 80 | unchanged | 00 00 FF 80 | same: clamped |
| 10 20 30 FF | unchanged | 30 20 10 (RGB) | opaque: both forms agree |
| 00 00 00 00 | unchanged | 0 0 0 0 | |
| 40 80 C0 00 | unchanged | 0 0 0 0 | colour under alpha 0 is dropped |

Finding: `createFromBitmap` expects premultiplied BGRA. A straight-alpha buffer is wrong only on partly transparent pixels (anti-aliased edges): they come out lighter or clamped. Opaque and fully transparent pixels are the same under both forms, so every pixel in architecture 7.8's table is unaffected.

## `addRepresentation` with a raw buffer

- `addRepresentation({ scaleFactor, width, height, buffer })` with a raw BGRA buffer works for 1, 1.25, 1.5 and 2 (16, 20, 24, 32 px). `getScaleFactors()` = [1, 1.25, 1.5, 2]; `getSize()` = 16x16 (dip); `toBitmap({ scaleFactor })` returns each representation's own pixels.
- Without `width` and `height`, a raw buffer is silently ignored (image stays empty, no throw). A PNG buffer needs no size.

## Which representation is used

| Case | Image given | Seen |
|---|---|---|
| Tray, 4 representations (1x red, 1.25x green, 1.5x blue, 2x yellow) | `new Tray(img)` | **red**: the 1x (16 px) representation, scaled up to the 24 px slot at 150% |
| Window `icon`, same 4 representations | `new BrowserWindow({ icon })` | taskbar shows **red**: the 1x representation |
| Window `icon`, only a 2x representation | | taskbar shows it (yellow): the one present is used |
| Window `icon`, one 256 px representation at scale 1 | | taskbar shows it (green), scaled down |
| desktopCapturer `appIcon` of that window | | 16x16, red |

Findings for C8:
1. On Windows, neither the tray nor the window icon picks a representation by display scale: they use the 1x representation (or the only one), and the shell scales it. Extra representations are ignored there. At scale 1.5 a 16 px 1x tray image is upscaled to 24 px (blurry).
2. So the tray image should be one representation drawn at the pixel size the tray slot needs (16 x the display's scale factor, 24 here; architecture 7.8 allows integer sizes 16 to 512), or a larger one (32) left to the shell to scale down. The window icon should be one large representation (for example 256 px) that the shell scales down for the taskbar and Alt+Tab.
3. `logoBitmap` should emit premultiplied BGRA if it anti-aliases edges (or no partial alpha at all if it samples pixel centres).
4. Not probed: Alt+Tab (its large icon), a second monitor with another scale factor, a scale change while running, the tray icon when pinned to the visible area (it sat in the overflow, drawn at the same size).
