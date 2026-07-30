# Turning the image bank on

Two things to switch on, both in Vercel, both about five minutes. They are
independent: uploading your own pictures works without the photo library, and
the photo library works without the store. Until each one is set, its tab in the
picker says exactly what is missing rather than quietly doing nothing.

The project is **tg-sites-shell**, not tg-sites.
<https://vercel.com/agendasgroup/tg-sites-shell>

---

## 1. Storage, so people can upload their own images

Images go to a Vercel Blob store. Fonts stayed in Postgres, deliberately, but
images are far bigger and far more numerous, and a photograph belongs behind a
CDN rather than inside a database.

1. Open the project, then the **Storage** tab
2. **Create Database** (or **Connect Store** if you already have one), choose
   **Blob**
3. Give it a name and connect it to this project
4. Tick all three environments if it asks: Production, Preview, Development
5. **Redeploy**

Vercel adds the token itself. You do not have to copy anything.

**One thing to know about the name.** A project with a single Blob store gets
`BLOB_READ_WRITE_TOKEN`. A store connected under its own name can arrive as
something like `TG_Blob_READ_WRITE_TOKEN`, which is what happened in the widget
suite. The code reads either, so both work. If you are sharing the widget
suite's existing store, that is fine too: everything here is filed under
`sites/<site id>/media/`, so nothing can collide with the offer photos.

### Redeploy, or nothing changes

Vercel gives a deployment its environment variables at the moment the deployment
is created. Adding a variable afterwards never reaches a build that already
exists. This is the same thing that made the sign-in page say it was not set up
back in July, so it is worth saying twice: **add the variable, then redeploy.**

---

## 2. Pexels, for the photo library

Free, no card, and the free tier is 200 searches an hour and 20,000 a month,
which is far more than a few people picking hero images.

1. Go to <https://www.pexels.com/api/> and sign up
2. Copy the API key it gives you
3. In Vercel, open **Settings**, then **Environment Variables**
4. **Key**: `PEXELS_API_KEY`
5. **Value**: the key
6. Tick all three environments
7. **Save**, then **redeploy**

That is all. The library tab then opens on a wall of curated photographs before
anybody types anything.

### What the terms ask of us, and where it is handled

The Pexels licence lets these photographs be used commercially without credit.
The API terms are stricter than the licence: an application that uses the API
has to name the photographer and link back to the photo's page on Pexels.

That is why the credit is shown under every photograph in the grid, and why it
is stored on the image when you add one. Nothing needs doing about it, but do
not strip it out later thinking it is decoration.

---

## What happens when somebody uploads a picture

Worth knowing, because it explains why a 6MB photograph off a phone appears in
the library as 400KB.

1. The browser measures the image and, if the longest edge is over 2400px or the
   file is over about 1.2MB, redraws it smaller and re-encodes it as WebP.
   Nothing on a website needs more than 2400px, and every pixel past that is
   bytes a visitor pays for and cannot see.
2. It asks our server for permission to upload. The server checks who is asking,
   and refuses to grant anything outside that site's own storage prefix.
3. The browser uploads **straight to the store**. The file never passes through
   our server, which matters: a serverless function cannot accept a request body
   over 4.5MB, so any other arrangement would refuse the most ordinary file
   anyone will ever pick.
4. The browser tells the server it is done, and the server asks the STORE what it
   actually holds before writing anything down. Size and type come from there,
   not from the browser.

GIFs are left completely alone. Redrawing one would keep the first frame and
throw the animation away, which for the one format people choose because it
moves is the worst possible silent change.

---

## What is not proven yet

Honest list, because the environment this was built in could not reach either
service. `blob.vercel-storage.com` and `api.pexels.com` are both blocked by the
egress policy on the build session, so:

- **The upload itself** has never run. Every layer either side is tested, and the
  browser-to-store pattern is the same one `api/upload-photo.js` in the widget
  suite has been using in production, but the first real upload is the first
  proof.
- **A live Pexels response** has never been parsed. The parser is tested against
  a captured response shaped from Pexels' documentation, and it is written to
  drop anything it does not recognise rather than throw, so a shape surprise
  shows as missing photographs rather than an error page.

If a picture uploads but shows as broken, look at the recorded URL first. If the
library returns nothing, check the key: a wrong one gives a clear message,
because a 401 is handled separately from everything else.
