# TickForge + cheesecake2

This package keeps the supplied TickForge files and adds `cheesecake2.js`.

Implemented in the first integration pass:
- Previous Day/Week/Month OHLC price lines
- Current Day/Week/Month O/H/L price lines
- 5D ATR calculation from daily groups
- Current / previous / previous-2-day ATR-derived levels
- 5D ATR display
- MTF OHLC data calculation, including optional HA transformation
- Replay-safe calculation when called with the replay-visible candle array

Important:
- The browser cannot execute Pine Script directly.
- This is a JavaScript port of the cheesecake2 calculations.
- The existing app's replay engine was not rewritten or removed.
- The MTF boxes are calculated but not yet rendered as true chart rectangles in this pass because the current chart setup exposes only the standard series API.
- Session timezone semantics in the supplied cheesecake2 code are exchange/Pine based; this first pass uses UTC grouping for D/W/M. Exact New York/session boundary parity should be implemented after the first visual check.
