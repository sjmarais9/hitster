# Spotify extended quota: closed to us

**Do not spend time on this.** Extended quota mode cannot be obtained for this
app, and the restriction is permanent rather than a matter of persuasion.

## The criteria

Since 15 May 2025, Spotify accepts extended quota applications **from
organisations only**. The requirements are:

- A legally registered business entity
- A launched service, currently live
- **At least 250,000 monthly active users**
- Availability in key Spotify markets
- Demonstrable commercial sustainability

Individual and hobby developers are excluded outright. There is no form to
submit and no case to argue — which is why no extension request link appears in
the dashboard for this app.

Source: <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>

## What that permanently costs us

Development mode is what we have, and it means:

1. **A daily request quota that gates the import.** One run returned
   `Retry-After: 76289` — a 21-hour lockout, mid-batch. Roughly 500 songs a day
   is the practical ceiling.
2. **`popularity` stripped** from every track object, on search and on
   `GET /tracks/{id}` alike.
3. **`GET /tracks?ids=` returns 403** regardless of how many ids are passed.
4. **A five-user limit.** Not a problem here: the game runs on the owner's
   account and the phone is passed around, so only one account ever
   authenticates.

Points 2 and 3 come from the November 2024 endpoint restrictions rather than
from quota, so even a hypothetical extension might not have restored them.

## What we do instead

The design already routes around all of it, and should stay that way. Spotify is
used for the two things only it can do — playback, and resolving a song to a
playable URI — and for nothing else.

| Need | Source | Cost |
|---|---|---|
| Canonicity / familiarity signal | Deezer public API | no key, no auth, no quota |
| Original release year verification | MusicBrainz | no key, polite user agent |
| Track URIs for playback | Spotify | rate limited, unavoidable |
| Playback itself | Spotify Web Playback SDK | unavoidable |

The import checkpoints every 25 songs and resumes, so a quota lockout costs
time rather than progress. A large backlog is imported across several days
rather than in one run. That is the permanent shape of this project, not a
temporary inconvenience.
