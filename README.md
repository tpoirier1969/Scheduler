# Tod + Donna Shared Calendar V1.0

A responsive shared weekly calendar for Donna, Tod, Frank, and Shared events.

## Included

- 30-minute grid calendar blocks
- Phone portrait 5-day view
- Phone landscape week-like grid
- Tablet and laptop 7-day views
- Person filter: All, Donna, Tod, Frank, Shared
- Person-specific presets and color palettes
- No-show status
- Weekly print overview
- Schedule density and lunch-risk indicator
- Recurring blocks: weekly/daily with selected weekdays and end date
- Seed events imported from the April and May 2026 CSV files
- Supabase schema with project-scoped table/function/policy names using `tod_donna_calendar_`

## Supabase setup

1. Open Supabase SQL Editor.
2. Run `supabase-schema.sql`.
3. Open `config.js`.
4. Fill in:

```js
window.TOD_DONNA_CALENDAR_SUPABASE_URL = 'YOUR_SUPABASE_URL';
window.TOD_DONNA_CALENDAR_SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Do not rename the SQL objects unless you also update the app code.

## Important import limitation

CSV files do not preserve strikethrough formatting. No-show detection from crossed-out names requires an XLSX export or Google Sheets API access. This V1 catches visible text cues like `No Reya`.

## Not included yet

- Drag-and-drop editing
- External calendar import/subscription
- Availability-mode highlight rendering
- Quick-add natural language parser
- Full recurring-event exception UI for “this occurrence / future / whole series”
- Authentication-specific row-level security
