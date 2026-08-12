# The scheduled import

The song pool grows on its own. This is how, and what to check when it does not.

## What runs

Task **"Hitster import"**, every 4 hours, running
`scripts\import-daily.cmd`, which walks the batches oldest first and resolves
songs to Spotify URIs until the daily quota runs out.

Frequent polling is deliberate. The quota lockout is not aligned to a calendar
day - it has come back at 21 hours and at 9.2 hours - so the window opens at a
different time each cycle. Trying every four hours catches it within a few hours
of opening rather than up to a day later, and an attempt that hits the lockout
costs one API call and exits cleanly.

## Settings that matter

Windows defaults would have made this barely work:

| Setting | Default | Ours | Why |
|---|---|---|---|
| `StartWhenAvailable` | off | **on** | Missed runs are otherwise skipped entirely. With the machine off overnight, the only good window in a cycle could be lost every time. |
| `AllowStartIfOnBatteries` | off | **on** | On a laptop the task would simply never start unplugged. |
| `DontStopIfGoingOnBatteries` | off | **on** | Otherwise unplugging kills a run in progress. |
| `MultipleInstances` | queue | **IgnoreNew** | Two imports writing the pool at once would have the second overwrite the first. |
| `ExecutionTimeLimit` | 72h | **4h** | A run should take minutes. Four hours means a hung one is killed before the next is due. |

## When the PC is off

Nothing runs, and that is fine. The quota is a rate limit that clears, not an
allowance that expires, so a missed window costs time rather than progress.
With `StartWhenAvailable` on, Windows runs the missed task shortly after the
machine is next available rather than waiting for the following slot.

## Checking on it

```
schtasks /query /tn "Hitster import" /fo list
type logs\import.log
```

The log appends, so a failure overnight leaves evidence.

Exit codes: `0` finished, `75` quota reached and stopped for today which is
normal and expected, anything else is a real failure. The `.cmd` wrapper maps 75
to success so Task Scheduler does not report a daily failure for the expected
case.

## When it needs a person

Almost never, but:

- **The refresh token is rejected.** It is cached in `.spotify-token.json` and
  survives indefinitely, but revoking app access in a Spotify account would
  invalidate it. The log will say so, and the fix is one interactive run.
- **A batch finishes and a new one is added.** Add the filename to `BATCHES` in
  `scripts/import-daily.mjs`.

## Controls

```
schtasks /run    /tn "Hitster import"                 run now
schtasks /change /tn "Hitster import" /st 02:15       shift the slot
schtasks /delete /tn "Hitster import" /f              remove it
```
