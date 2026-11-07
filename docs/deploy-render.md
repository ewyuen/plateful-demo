# Running Plateful on Render (a free hosted copy)

How the app can be run as a free, hosted copy on [Render](https://render.com), with the database moving to an external Postgres service later. It is an extra way to run the app next to Docker Compose and Kubernetes (minikube); neither needs it. It is a **sandbox demo**, not production: PayPal sandbox only, no backups, no custom domain. A hosted copy runs at https://plateful-web.onrender.com while the hackathon is judged and may be taken down afterwards.

Everything here was done on Render's free plan in November 2026. Free plans change, so check Render's page and your database host's if a number below looks stale.

## What runs where

```
 browser --> plateful-web (static site)  --/api/*-->  plateful-api (Docker web service)  --> Postgres
              serves the React build;                  backend/Dockerfile.render              Render's free Postgres,
              /api is a rewrite, so the browser        one gunicorn worker                    later an external database
              sees ONE origin
```

| Part | Plan | Built from |
| --- | --- | --- |
| Database | Render Postgres 17, free (expires 30 days after creation), later an external Postgres | |
| `plateful-api` | Docker web service, free (sleeps when idle) | `backend/Dockerfile.render` |
| `plateful-web` | static site, free | `frontend/` |

**One origin.** Staff, admin and customer sign-in use a session cookie and a CSRF cookie, both `SameSite=Lax`. A page and an API on two different addresses would not receive each other's cookies, so the page's address forwards `/api/*` to the API with a Render rewrite rule, and the browser only ever talks to the page's address.

**Why `Dockerfile.render`.** It is the same as `backend/Dockerfile` except for its last line, which runs `backend/render-start.sh`. A free Render service has no shell and no pre-deploy step, and its CPU is about a tenth of a core, where each Python start-up and the import of the Anthropic SDK are very slow. So the start script splits the database address and sets the allowed hosts, then starts gunicorn with `backend/render_gunicorn.py`, which runs the migrations, loads the starter data, creates the demo users and imports every URL module **once**, before the single worker starts. Everything it does is safe to repeat. `Dockerfile` itself is not changed, so Compose and Kubernetes work as before.

## What you need

- A Render account connected to GitHub, a fork or copy of this repository (or this one, as a public repository).
- A PayPal **sandbox** app (client ID and secret) and a sandbox Personal buyer account.
- Optional: an Anthropic key (without it the assistant says it is unavailable; set a spend cap first).
- Later: an account with a hosted Postgres service for the external database, and Docker on your own machine for the database move.

## Free-tier limits to expect

| What | Limit | What you will see |
| --- | --- | --- |
| Web service idle | Sleeps after 15 minutes without traffic; waking takes about a minute | The first load after a pause is slow |
| New deploy or empty database | About 2.5 minutes at 0.1 CPU | The service shows "Deploying" for a while |
| Instance hours | 750 per workspace per month for free web services | One always-awake service uses about 744: do not add a second |
| Render Postgres (free) | 1 GB; **expires 30 days after it is created**, then 14 days to upgrade before it is deleted; one per workspace | See "Move the database to an external Postgres" |
| External Postgres host | Free plans differ: some cap storage and compute-hours, or put the database to sleep when idle | Check your host's limits. A staff page left open polls the queue every 5 seconds and keeps a sleeping database awake |
| Shell, pre-deploy step | Not available on free web services | Everything runs from the image's start-up |

## Create it

Create the three pieces in this order. Render's labels change now and then; the settings matter, not the wording.

**1. The database.** New > PostgreSQL. Free plan, **PostgreSQL version 17** (not the default, which is newer: a dump restores into a newer server but not into an older one, so this keeps the later move simple). When it is ready, open its **Info** page: you need the **Internal** database URL now, and the **External** one only for the move later.

**2. The API.** New > Web Service, from this repository, branch `main`. Language: Docker. Dockerfile path `./backend/Dockerfile.render`, Docker build context `./backend`. Free plan. Health check path `/api/health/live/` (not `/ready`, which queries the database and would keep an idle-sleeping external database awake). Environment:

| Variable | Value |
| --- | --- |
| `DJANGO_SECRET_KEY` | A new random string (for example `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`); never reuse a local one |
| `DJANGO_DEBUG` | `false` |
| `DJANGO_SECURE_COOKIES` | `true` |
| `DJANGO_BEHIND_TLS_PROXY` | `true` |
| `PGSSLMODE` | `require` |
| `DATABASE_URL` | The database's **Internal** URL |
| `DEMO_PASSWORD` | The sandbox password for the demo accounts (below) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | The sandbox app's client ID and secret |
| `ANTHROPIC_API_KEY` | Optional |
| `ASSISTANT_RATE` | `10/min` |
| `PUBLIC_ORIGIN` | Set in step 4, when the page's address is known |
| `EXTERNAL_DATABASE_URL` | Left out until the database moves to an external Postgres; when set it is used instead of `DATABASE_URL` |

Type secrets in the dashboard only. Never put one in a file in the repository. Wait for the service to show **Live** (the log shows the migrations, the starter data, "Demo users", then "Listening") and note its address, `https://<api>.onrender.com`.

**3. The page.** New > Static Site, from the same repository and branch. Build command `cd frontend && npm ci && npm run build`, publish directory `frontend/dist`. Environment: `NODE_VERSION` `24`, `VITE_API_URL` `/api`, and `VITE_PAYPAL_CLIENT_ID` (the sandbox **client ID**, which is public by design). The page reads it **when it is built**: if it was empty at the first build, set it and then deploy again with the build cache cleared, or the page will say payment is unavailable. Under Redirects/Rewrites add, in this order:

| Type | Source | Destination |
| --- | --- | --- |
| Rewrite | `/api/*` | `https://<api>.onrender.com/api/*` |
| Rewrite | `/*` | `/index.html` |

There is deliberately no rule for `/admin`: Render drops the trailing slash when it rewrites `/admin/`, Django answers with a redirect back to `/admin/`, and the browser loops. Use the admin at the API's own address (below).

**4. Trust the page.** Set `PUBLIC_ORIGIN` on the API to the page's address, for example `https://plateful-web.onrender.com`, with **no trailing slash**. Django must trust it for the CSRF check; without it every sign-in answers a 403. The API restarts (2 to 3 minutes).

## Demo accounts

`staff-corner-kitchen` (and one `staff-<restaurant>` for each starter restaurant), `demo-customer`, `owner` and `admin`, all with the sandbox password you set in `DEMO_PASSWORD` (`Password1` on the hosted copy, the same as the Compose guide). Staff, the owner and customers sign in at `/login` on the page; the owner lands on the Dashboard (every restaurant's paid orders, view only) and an admin on the Fulfilment page. The Django admin is at the API's own address, `https://<api>.onrender.com/admin/`. At every start the demo accounts are set to `DEMO_PASSWORD` (the seed command alone never changes an existing user's password); no other account is touched, and the starter restaurants and menu are reloaded. Orders and accounts created on the site are kept.

## Check that it works

```bash
WEB=https://plateful-web.onrender.com          # the page's address
curl -s -o /dev/null -w '%{http_code}\n' $WEB/api/health/live/     # 200 (the first call may take a minute)
curl -s $WEB/api/restaurants/ | head -c 200                         # the starter restaurants
```

Then, in a private window, choose a restaurant, add a dish, check out as the sandbox buyer and see "Payment received" with an order code; sign in at `/login` as `staff-corner-kitchen` and open the staff queue (by default it shows active orders only; a completed order drops out). Sign in as `owner` and the Dashboard shows the order you just made. A wrong login must answer `400` with a JSON message, not a CSRF 403:

```bash
jar=$(mktemp); curl -s -o /dev/null -c "$jar" $WEB/api/auth/me/; tok=$(awk '$6=="csrftoken"{print $7}' "$jar")
curl -s -b "$jar" -X POST $WEB/api/auth/login/ -H "Origin: $WEB" -H "Referer: $WEB/login" \
  -H "X-CSRFToken: $tok" -H "Content-Type: application/json" -d '{"username":"nobody","password":"wrong"}'
```

## Problems that came up

| Symptom | Cause | Fix |
| --- | --- | --- |
| Login answers `403 CSRF verification failed` (an HTML page) | Django does not trust the page's address | Set `PUBLIC_ORIGIN` exactly (no trailing slash) and let the API restart; the reason is in the API's log, search for `Forbidden` |
| The page says payment is unavailable | `VITE_PAYPAL_CLIENT_ID` was empty when the page was built | Set it on the static site, then deploy with the build cache cleared |
| Checkout answers 503 | `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET` is missing on the API | Set both, from the same sandbox app |
| A demo password does not work | The accounts were created with another password | The API resets the demo accounts to `DEMO_PASSWORD` at every start; check the variable and the log line `render: the demo accounts now use DEMO_PASSWORD` |
| `/admin/` on the page's address redirects in a loop | The rewrite drops the trailing slash | Use the API's own address |
| Log lines `Worker was sent SIGKILL`, `Error handling request HEAD /` | The first request imported the Anthropic SDK, very slow at 0.1 CPU | Already handled by `render_gunicorn.py` (one worker, the import done up front, a 120 s timeout) |
| The staff queue is empty after finishing an order | It shows active orders only | Ask for `?status=confirmed,preparing,ready,out_for_delivery,completed,cancelled` |

## Move the database to an external Postgres

Render's free database expires **30 days after it is created** (14 more days to upgrade before it is deleted), and a hackathon is judged for weeks. Move it well before day 30. The steps below were run with a real copy of the data: both restore forms exited 0, all 18 tables had equal row counts, and the app then ran on the external database with the restored accounts and orders.

Postgres versions: dump with a client of the **same major version as the server** (17 here). The new server may be a newer version (a 17 dump restored into 18 here) but not an older one, and the restore client must be at least the target's version: check both with `show server_version`. Use your host's **direct** connection string, not a pooled one (a connection pooler in transaction mode can break migrations and session features). Keep both connection strings out of files in the repository, out of your shell history and out of chat:

```bash
read -rsp 'Render external URL: ' RENDER_DB_URL; echo      # database > Info > External Database URL
read -rsp 'External database URL (direct): ' EXT_DB_URL; echo
export RENDER_DB_URL EXT_DB_URL
```

1. **Stop writes:** suspend `plateful-api` in Render.
2. **Dump** from Render into a private folder (it holds user records):
   ```bash
   mkdir -p ~/plateful-dumps && chmod 700 ~/plateful-dumps
   docker run --rm --user "$(id -u):$(id -g)" -e U="$RENDER_DB_URL" -v ~/plateful-dumps:/out postgres:17-alpine \
     sh -c 'pg_dump -Fc --no-owner --no-acl -d "$U" -f /out/render.dump'
   ```
3. **Create a rollback point** on the external host (a snapshot or a branch, if it offers one) before restoring into a database that matters.
4. **Restore** into the external database with a client of its version (18 here; set `TARGET_MAJOR` to yours):
   ```bash
   docker run --rm --user "$(id -u):$(id -g)" -e U="$EXT_DB_URL" -v ~/plateful-dumps:/out postgres:$TARGET_MAJOR-alpine \
     sh -c 'pg_restore --no-owner --no-acl --exit-on-error -d "$U" /out/render.dump; echo "exit: $?"'
   ```
   If the tables already exist there, add `--clean --if-exists`.
5. **Compare the row counts of every table** on both sides; there must be the same number of lines (18) with no line containing `ERROR`, or nothing is verified:
   ```bash
   SQL="select table_name||' '||((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1])::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
   for U in "$RENDER_DB_URL" "$EXT_DB_URL"; do
     docker run --rm -e U="$U" -e Q="$SQL" postgres:$TARGET_MAJOR-alpine sh -c 'psql "$U" -At -v ON_ERROR_STOP=1 -c "$Q"'
   done
   ```
6. **Switch:** on `plateful-api` > Environment, add `EXTERNAL_DATABASE_URL` (the external database's direct string, typed in the dashboard) and resume the service. The start script uses it instead of `DATABASE_URL`.
7. **Check:** a misspelt name would fall back to Render's database without any error, so suspend Render's database and check that the site still works: health `/api/health/ready/` (a real query) answers 200, the staff accounts and old orders are there, and a **new** sandbox order appears in the staff queue (and in the external database, not in Render's database).
8. **Clean up:** delete the dump file (`rm ~/plateful-dumps/render.dump`), and delete Render's database when you are sure. If something goes wrong, removing `EXTERNAL_DATABASE_URL` and resuming the Render database is the way back.

## Delete everything

Delete `plateful-web`, `plateful-api` and the database in Render, delete the external database, remove Render's GitHub access if you no longer want it, and rotate the sandbox app and the Anthropic key if they were only for this. Then check that Render lists no services or databases and the external host lists no database.
