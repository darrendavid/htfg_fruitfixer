# Component Requirements — HTFG Review UI

## ShadCN Components Available

All components installed in `src/components/ui/`:

| Component | File | Used In |
|-----------|------|---------|
| Alert | `alert.tsx` | Error states, session expired |
| AlertDialog | `alert-dialog.tsx` | Destructive action confirmations |
| Badge | `badge.tsx` | Confidence level, status pills |
| Button | `button.tsx` | All action buttons |
| Card | `card.tsx` | Login/register forms, stat cards |
| Command | `command.tsx` | Plant search autocomplete |
| Dialog | `dialog.tsx` | Discard dialog, New Plant dialog |
| Form | `form.tsx` | Login, register, new plant forms |
| Input | `input.tsx` | Email, name, plant search fields |
| Label | `label.tsx` | Form field labels |
| Popover | `popover.tsx` | Plant search dropdown anchor |
| Progress | `progress.tsx` | Queue completion bars |
| RadioGroup | `radio-group.tsx` | Discard category selection |
| ScrollArea | `scroll-area.tsx` | Completion log table, detail panel |
| Select | `select.tsx` | Admin log filters, category dropdowns |
| Separator | `separator.tsx` | Section dividers |
| Skeleton | `skeleton.tsx` | Loading states for images and cards |
| Sonner | `sonner.tsx` | Toast notifications (IDK escalation, errors) |
| Table | `table.tsx` | Completion log, admin users, leaderboard |
| Tabs | `tabs.tsx` | Admin dashboard sections |
| Textarea | `textarea.tsx` | Discard notes field |

---

## Component Tree Per Screen

### Screen 0: Login / Register (`/login`, `/register`, `/admin/login`, `/check-email`)

```
LoginPage
  └── Card > CardHeader + CardContent + CardFooter
        ├── CardTitle ("HTFG Image Review")
        ├── Form > FormField > Input (email)
        ├── Button ("Send Login Link") [loading state: disabled + Spinner]
        ├── Alert (error state: "No account found")
        └── Link to /register

RegisterPage
  └── Card
        ├── Form > FormField > Input (email, first_name, last_name)
        ├── Button ("Create Account & Send Login Link")
        ├── Alert (error: "Email already registered")
        └── Link to /login

CheckEmailPage
  └── Card
        ├── MailIcon (lucide-react)
        ├── "Check your email!" heading
        ├── Description with email address
        └── Button ("Resend email")

AdminLoginPage
  └── Card
        ├── Form > FormField > Input (email, password)
        ├── Button ("Sign In")
        └── Alert (error: "Invalid credentials")
```

### Screen 1: Swipe (`/swipe`)

```
SwipePage (AuthGuard → AppShell)
  ├── SwipeCard
  │     ├── LazyImage (full-size photo)
  │     ├── PlantNameDisplay
  │     └── ConfidenceBadge (Badge variant: high=green, medium=amber, low=red, auto=blue)
  ├── SwipeActions
  │     ├── Button ("← REJECT", variant=destructive)
  │     ├── Button ("? IDK", variant=outline, muted)
  │     └── Button ("CONFIRM →", variant=default/green)
  └── DetailPanel (slide-up overlay)
        ├── ScrollArea
        │     ├── MatchDetails (match_type, reasoning, matched_term)
        │     └── ReferencePhotoGrid (6x LazyImage thumbnails)
        └── Separator
```

### Screen 2: Classify (`/classify`)

```
ClassifyPage (AuthGuard → AppShell)
  ├── LazyImage (current image)
  ├── SourcePathDisplay
  ├── PlantSearch
  │     ├── Input (search field)
  │     └── Command > CommandList > CommandItem[] (search results)
  │           └── Each item: common_name + botanical_name (italic)
  ├── QuickPicks (6x Badge/Button for recent plants)
  ├── ClassifyActions
  │     ├── Button ("✓ Assign to Plant") [disabled until plant selected]
  │     ├── Button ("+ New Plant Entry") → NewPlantDialog
  │     ├── Button ("✕ Not a Plant") → DiscardDialog
  │     └── Button ("⏭ Skip")
  ├── DiscardDialog (Dialog)
  │     ├── RadioGroup (event, graphics, travel, duplicate, poor_quality)
  │     ├── Textarea (notes, optional)
  │     └── Button ("Discard") + Button ("Cancel")
  └── NewPlantDialog (Dialog)
        ├── Form
        │     ├── Input (common_name, required)
        │     ├── Input (botanical_name)
        │     ├── Select (category: fruit/nut/spice/flower/other)
        │     └── Input (aliases, comma-separated)
        ├── CsvCandidateMatch (Alert, shown if CSV match found)
        ├── Alert ("⚠ This will flag Phase 4B for re-run")
        └── Button ("Create & Assign") + Button ("Cancel")
```

### Screen 3: Leaderboard (`/leaderboard`)

```
LeaderboardPage (AuthGuard → AppShell)
  ├── OverallProgress
  │     ├── Progress bar (combined swipe+classify completion %)
  │     └── "{completed} / {total} reviewed" text
  ├── MyStats (Card)
  │     ├── "Today: {count} reviewed"
  │     ├── "All time: {count} reviewed"
  │     └── "Rank: #{rank}"
  └── LeaderboardTable
        └── Table > TableHeader + TableBody
              └── TableRow[] (rank, initials, count)
                    └── Highlighted "You" row for current user
                    └── Top 3: gold/silver/bronze Badge styling
```

### Screen 4: Admin Dashboard (`/admin`)

```
AdminDashboardPage (AdminGuard → AppShell)
  └── Tabs (Overview | Completion Log | IDK Flagged | Users)
        ├── Tab: Overview
        │     ├── QueueStatusCards (2x Card with Progress)
        │     ├── DecisionBreakdown (Card with counts per action)
        │     ├── RerunBanner (Alert, amber, shown when rerun_count >= 5)
        │     ├── IdkFlaggedSection (Alert with count + link)
        │     ├── FullNameLeaderboard (Table)
        │     └── TodayActivity (Table)
        ├── Tab: Completion Log
        │     └── CompletionLog
        │           ├── Filters (Select: action, user; Input: date range)
        │           ├── ScrollArea > Table (thumbnail, path, action, reviewer, plant, timestamp)
        │           └── Pagination (prev/next buttons + page count)
        ├── Tab: IDK Flagged
        │     └── IdkFlaggedList
        │           └── Table > TableRow[] (thumbnail, plant name, idk_count, "Classify Now" button)
        └── Tab: Users
              └── UsersTable
                    └── Table (email, name, role, reviews today, reviews all-time, last active)
```

---

## Custom Components Needed

| Component | File | Description |
|-----------|------|-------------|
| `AuthGuard` | `src/components/auth/AuthGuard.tsx` | Redirect to /login if not authenticated; show skeleton while loading |
| `AdminGuard` | `src/components/auth/AdminGuard.tsx` | AuthGuard + role=admin check; redirect to /admin/login if not admin |
| `AppShell` | `src/components/layout/AppShell.tsx` | Header + BottomNav wrapper |
| `BottomNav` | `src/components/layout/BottomNav.tsx` | 3 or 4 tabs (admin-conditional), active state via useLocation |
| `SwipeCard` | `src/components/swipe/SwipeCard.tsx` | react-swipeable gesture handler + image display |
| `SwipeActions` | `src/components/swipe/SwipeActions.tsx` | REJECT / IDK / CONFIRM buttons |
| `DetailPanel` | `src/components/swipe/DetailPanel.tsx` | Slide-up panel with match details + reference photos |
| `PlantSearch` | `src/components/classify/PlantSearch.tsx` | Debounced search using Command component |
| `QuickPicks` | `src/components/classify/QuickPicks.tsx` | Recently-used plant buttons from localStorage |
| `DiscardDialog` | `src/components/classify/DiscardDialog.tsx` | RadioGroup + optional Textarea in Dialog |
| `NewPlantDialog` | `src/components/classify/NewPlantDialog.tsx` | New plant form + CSV candidate lookup |
| `ClassifyActions` | `src/components/classify/ClassifyActions.tsx` | Assign / New Plant / Discard / Skip buttons |
| `LazyImage` | `src/components/images/LazyImage.tsx` | IntersectionObserver-based lazy loader with Skeleton fallback |
| `ReferencePhotoGrid` | `src/components/images/ReferencePhotoGrid.tsx` | 2x3 grid of LazyImage thumbnails |
| `ConfidenceBadge` | `src/components/ui/ConfidenceBadge.tsx` | Badge with high/medium/low/auto color variants |
| `OverallProgress` | `src/components/leaderboard/OverallProgress.tsx` | Progress bar + "{n} / {total} reviewed" |
| `MyStats` | `src/components/leaderboard/MyStats.tsx` | Personal stats card |
| `LeaderboardTable` | `src/components/leaderboard/LeaderboardTable.tsx` | Ranked table with initials + "You" highlight |
| `QueueStatusCards` | `src/components/admin/QueueStatusCards.tsx` | Side-by-side swipe/classify progress cards |
| `DecisionBreakdown` | `src/components/admin/DecisionBreakdown.tsx` | Counts by action type (confirm/reject/classify/discard/idk) |
| `FullNameLeaderboard` | `src/components/admin/FullNameLeaderboard.tsx` | Admin leaderboard with full names |
| `TodayActivity` | `src/components/admin/TodayActivity.tsx` | Per-reviewer today's review count |
| `RerunBanner` | `src/components/admin/RerunBanner.tsx` | Amber alert when new plant threshold reached |
| `IdkFlaggedSection` | `src/components/admin/IdkFlaggedSection.tsx` | Alert + link to IDK tab |
| `CompletionLog` | `src/components/admin/CompletionLog.tsx` | Filterable, paginated table |
| `UsersTable` | `src/components/admin/UsersTable.tsx` | All registered users with stats |

---

## State Management

| Layer | Approach |
|-------|----------|
| Auth state | `AuthContext` (React Context) — `user`, `isLoading`, `logout()` |
| Page-level state | Local `useState` within each page component |
| Quick picks | `localStorage` via `useRecentPlants` hook |
| API calls | Direct fetch in event handlers / `useEffect`, no external library |
| Polling | `setInterval` in `useEffect` with cleanup (leaderboard + admin: 30s) |

---

## Role-Based Routing

| Route | Guard | Redirect if unauthorized |
|-------|-------|--------------------------|
| `/login`, `/register` | None (redirect away if logged in) | → `/swipe` if already authed |
| `/swipe`, `/classify`, `/leaderboard` | `AuthGuard` | → `/login` |
| `/admin` | `AdminGuard` | → `/admin/login` (not `/login`) |
| `/admin/login` | None | — |

---

## Mobile-First UX Requirements

- All tap targets: minimum **44px** height
- Bottom navigation: minimum **48px** height
- Swipe card: fills most of viewport height; action buttons below card
- Touch events: react-swipeable handles left/right/up gestures
- IDK shake animation: brief CSS `animation: shake 0.3s` after IDK tap before advancing
- Font sizes: minimum 16px on inputs (prevents iOS auto-zoom)
- Image loading: Skeleton placeholder while loading, fade in on load

---

## Semantic Color Tokens (defined in `src/index.css`)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-confirm` | `hsl(142 76% 36%)` | CONFIRM button, confirmed badge |
| `--color-reject` | `hsl(0 84% 60%)` | REJECT button, rejected badge |
| `--color-pending` | `hsl(38 92% 50%)` | Amber/warning states, rerun banner |
| `--color-auto` | `hsl(217 91% 60%)` | Blue, auto-confidence badge |
