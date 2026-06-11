# TG Slicer optional AI emit endpoint

Reference for the optional "AI smarten up" path. You do not need any of this for
the default build or the TravelTech Show demo. The default emitter runs locally
in the extension, with no endpoint, no secret and no network. Reach for this only
when you deliberately wire up AI emit.

## Endpoint

The deployed function is `api/slice-emit.js` in this repo, on the tg-widgets
Vercel project. Call it at:

- `https://widgets.travelify.io/api/slice-emit` (primary)
- `https://tg-widgets.vercel.app/api/slice-emit` (same function, Vercel alias)

Put one of these in the extension popup's **Endpoint** field.

## Auth

A shared secret. The extension popup's **Shared secret** field must match the
`TGS_SHARED_SECRET` environment variable on the tg-widgets Vercel project
exactly. The endpoint checks it on every call.

## Vercel environment variables

Set these on the tg-widgets project under Settings, Environment Variables.

| Variable | Required | Notes |
|---|---|---|
| `TGS_SHARED_SECRET` | yes | The shared secret above. |
| `ANTHROPIC_API_KEY` | yes | The model key. |
| `TGS_MODEL` | no | Override the default model. |
| `TGS_MAX_TOKENS` | no | Defaults to 32000. |
| `TGS_ALLOWED_ORIGIN` | no | Restrict which origin may call the endpoint. |

`vercel.json` sets `maxDuration` to 300 for `api/slice-emit.js`, because a
fidelity build can take one to three minutes.

## The one gotcha

Changing `TGS_SHARED_SECRET`, or any env var, needs a redeploy to take effect,
and the extension field must be updated to match. If the endpoint rejects a call
it is almost always one of two things: the secret in the extension does not match
the secret on Vercel, or the deploy is stale. Re-copy the secret into both places
and redeploy.
