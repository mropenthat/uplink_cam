# Publish UPLINK_CAM with working feeds + your domain

Use a host that runs the Python server so the feed proxy works over HTTPS. Then point your domain to it.

---

## 1. Deploy to Railway

1. Go to **[railway.app](https://railway.app)** and sign up (GitHub login is easiest).

2. **New Project** → **Deploy from GitHub repo**.

3. Select the repo **`mropenthat/uplink_cam`**. Railway will create a service.

4. The repo includes a **Procfile** (`web: python3 server.py`), so Railway will use that. If you need to set it manually: **Service → Settings → Deploy → Start Command:** `python3 server.py`.

5. **Generate domain:** Open the service → **Settings → Networking → Generate Domain**. You’ll get a URL like **`https://uplink-cam-production-xxxx.up.railway.app`**.

6. Open that URL — feeds should load (proxy on same host). Railway’s free tier has no spin-down like Render; long-lived streams are less likely to be cut.

**Custom domain on Railway:** Settings → Networking → Custom Domain → add your domain, then add the CNAME (or A) record Railway shows at your registrar (same idea as Render).

---

## 2. Deploy to Render (free tier)

1. Go to **[render.com](https://render.com)** and sign up (GitHub login is easiest).

2. **New → Web Service**.

3. Connect **GitHub** and select the repo **`mropenthat/uplink_cam`**.

4. Configure:
   - **Name:** `uplink-cam` (or any name)
   - **Region:** pick one close to you
   - **Branch:** `main`
   - **Root Directory:** leave **empty** (your repo root is already the app folder)
   - **Runtime:** `Python 3`
   - **Build Command:** leave empty (or `pip install -r requirements.txt` if you want the scraper deps; not required for the site)
   - **Start Command:** `python3 server.py`

5. Click **Create Web Service**. Render will build and run the app.

6. When it’s live, you’ll get a URL like **`https://uplink-cam.onrender.com`**. Open it — **feeds should load** (proxy is on the same host).

---

## 3. Use your own domain

1. In Render: open your **Web Service** → **Settings** → **Custom Domains**.

2. Click **Add Custom Domain** and enter your domain (e.g. `uplink.yourdomain.com` or `yourdomain.com`).

3. Render will show **CNAME** (for a subdomain) or **A** (for apex) records. Example:
   - **Subdomain** (e.g. `uplink.yourdomain.com`): add a **CNAME** record:
     - Name: `uplink` (or the subdomain you chose)
     - Value: `uplink-cam.onrender.com` (your Render URL host)
   - **Apex** (e.g. `yourdomain.com`): use the **A** record Render gives you.

4. In your **domain registrar** (where you bought the domain — Namecheap, Cloudflare, GoDaddy, etc.):
   - Open **DNS** for that domain.
   - Add the **CNAME** or **A** record exactly as Render shows.
   - Save. DNS can take a few minutes to a few hours.

5. Back in Render, click **Verify** next to the custom domain. When it turns green, traffic to your domain goes to the app.

6. Open **https://your-domain.com** — the site and feeds will work there.

---

## Summary

| Step | What to do |
|------|------------|
| 1 | Deploy repo to **Railway** or **Render**; start command `python3 server.py` (Procfile does this on Railway) |
| 2 | Test the generated URL — feeds should work |
| 3 | In the host dashboard, add your custom domain |
| 4 | At your registrar, add the CNAME (or A) record they give you |
| 5 | Verify, then use your domain |

No code changes needed for the domain — the app is served from whatever host and domain you point to it.

---

## Feeds still not loading on Render?

1. **Redeploy** after pulling the latest code (server cwd fix, proxy timeout, client retry).
2. **Check Render logs:** Dashboard → your service → **Logs**. Look for:
   - `Serving UPLINK_SITE at...` (server started).
   - Any `502 Proxy error` when you load a feed — means the proxy can’t reach the camera (slow/blocked camera or Render outbound limit).
3. **Start command:** Must be exactly `python3 server.py` (no `python` if that’s v2 on Render).
4. **Cold start:** On free tier the service sleeps; first load can take 30–60 s. The feed will retry once after 2 seconds if the first request fails.
