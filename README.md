# Anicafe Menu System

A real-time ordering app for café events. Cashiers, prep staff, and servers share orders through Cloud Firestore.

[Open the app](https://yuqiaoj.github.io/anicafe-menu/)

## Tabs

| Tab | Purpose |
| --- | --- |
| Cashier | Create orders, apply discounts, and assign seating zones. Open order numbers trigger a warning. |
| Prep | Track open orders and mark categories as prepared. All categories show by default; turn some off to focus on a station's share. |
| Servers | See every category's preparation status and mark orders as delivered. |
| Edit Menu | Unlock editing to add or remove categories, drag categories and items into order, and manage items, prices, stock, and dietary flags. Saves check for concurrent changes. |
| All Orders | View order history and sales totals, filtered by search, date, status, seating zone, or category. |

The Cashier and Edit Menu tabs retain unfinished work when switching tabs. Each device remembers its last tab, Prep categories, and color scheme.

## Setup

1. Create a Firebase project with Cloud Firestore enabled.
2. Add a `.env` file in the repository root with the Firebase web app configuration:

   ```env
   VITE_API_KEY=...
   VITE_AUTH_DOMAIN=...
   VITE_PROJECT_ID=...
   VITE_STORAGE_BUCKET=...
   VITE_MESSAGING_SENDER_ID=...
   VITE_APP_ID=...
   VITE_MEASUREMENT_ID=...
   ```

3. Seed the `menu` collection with category documents, using the category name as the document ID. For example, `menu/Drinks`:

   ```json
   {
     "categoryName": "Drinks",
     "position": 0,
     "items": [
       { "itemName": "Tea", "priceCents": 350, "stock": "high", "flags": [] }
     ]
   }
   ```

4. Configure Firestore security rules for the event. The app has no authentication, so its access depends on those rules.
5. Install dependencies and start the development server:

   ```sh
   npm install
   npm run dev
   ```

## Firestore

| Collection | Document ID | Fields |
| --- | --- | --- |
| `menu` | Category name | `categoryName`, `position`, `items` (`itemName`, `priceCents`, `stock`, optional `flags`) |
| `orders` | Auto-generated | `number`, `totalCents`, `discountCents`, `notes`, `zone`, `completed`, `specialtyOnly`, `timestamp`, `categories` |

Categories appear in ascending `position` on every tab. Categories without a `position` come last, in name order, and get one the next time the menu is saved. Items appear in the order of the `items` array.

Stock is `high`, `low`, or `none`. Order categories contain a `done` flag and items keyed by name, each with a `quantity`.

`specialtyOnly` is kept only to recognize old specialty-only orders. The `specialty` collection used by earlier versions is no longer read and can be deleted.

Prices are stored in integer cents and displayed in dollars. An order's `totalCents` is the amount after its discount. Readers also accept legacy dollar prices.

The order log has a column for each menu category, followed by any categories that appear only in past orders. Sales analytics count items per category.

No composite indexes are required.

## Development

The app uses React, TypeScript, Vite, Mantine, and Firebase. Tab pages live in `src/pages`, shared UI in `src/components`, and shared hooks in `src/hooks`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Type-check and build to `dist/`. |
| `npm run lint` | Run ESLint. |
| `npm run preview` | Preview the production build. |
| `npm run deploy` | Build and publish `dist/` to the `gh-pages` branch. |

Vite's base path is `/anicafe-menu/` for GitHub Pages; change `vite.config.ts` for another deployment path. Environment variables are embedded at build time, so the deployment build needs the Firebase configuration.
