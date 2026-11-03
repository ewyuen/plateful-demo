# Plateful frontend

The React + TypeScript + Vite app: pick a restaurant, build a cart from its menu, place an order and see the recent orders. It talks to the Django API only through `src/api/`.

## Commands

Run from this folder. The API must be running for the page to show data (see the root [README](../README.md)).

```bash
npm install
npm run dev        # http://localhost:5173 (the origin the API's CORS allowlist expects)
npm test           # Vitest + React Testing Library, runs once
npm run lint
npm run build      # type check + production build into dist/
npm run preview    # serves dist/ on :4173, which is NOT in the CORS allowlist
```

`VITE_API_URL` sets the API base URL (default `http://localhost:8000/api`; see `.env.example`). Vite bakes it in at build time, so restart `npm run dev` after changing it. The container image is built with `/api`, so the page calls the API on its own origin behind the Ingress.

## Where things are

- `src/api/`: typed `fetch` functions and error classes.
- `src/components/`: `RestaurantPicker`, `MenuList`, `OrderForm`, `OrderList`, each with a CSS module and tests.
- `src/orderDraft.ts` and `src/orderDraftContext.ts`: the cart, selected restaurant and customer name (a reducer shared through Context).
- `src/useFetch.ts`: the data-fetching hook used by the lists.
- `Dockerfile` and `nginx.conf`: the production image (Node build, then unprivileged nginx on port 8080).

More: [docs/architecture.md](../docs/architecture.md).
