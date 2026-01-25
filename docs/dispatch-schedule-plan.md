# Dispatch Schedule Page - UI/UX Plan

## Overview

A modern drag-and-drop scheduling interface for moving company dispatch operations. This plan focuses on UI/UX design to match QubeSheets' existing design system while improving upon traditional dispatch software.

---

## 1. Page Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                                 │
│  ┌─────────────────┬────────────────────────────────────────┬─────────────┐ │
│  │ Title + Tabs    │           Date Navigation              │   Actions   │ │
│  └─────────────────┴────────────────────────────────────────┴─────────────┘ │
├─────────────┬───────────────────────────────────────────────┬───────────────┤
│             │                                               │               │
│  RESOURCES  │              SCHEDULE TIMELINE                │    JOBS       │
│   PANEL     │                                               │    PANEL      │
│             │                                               │               │
│  (Trucks &  │    ┌─────────────────────────────────────┐    │  (Unscheduled │
│   Crew)     │    │      Time-based grid with           │    │   & Filters)  │
│             │    │      draggable job cards            │    │               │
│   240px     │    └─────────────────────────────────────┘    │    280px      │
│   fixed     │                                               │    fixed      │
│             │              flex-1 (fluid)                   │               │
├─────────────┴───────────────────────────────────────────────┴───────────────┤
│  FOOTER (optional - keyboard shortcuts hint)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Header Bar

**File:** `components/dispatch/ScheduleHeader.tsx`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Schedule                                                                     │
│ ┌──────────┬──────────────────┬─────────────┬────────────┐    ┌───────────┐ │
│ │Scheduling│ Crew Confirmation│  Monitoring │   Trips    │    │ ← Today → │ │
│ └──────────┴──────────────────┴─────────────┴────────────┘    │  Jan 20   │ │
│                                                                └───────────┘ │
│                                          ┌────────┬────────┬────────────────┐│
│                                          │ Print  │ Report │   Publish ▼   ││
│                                          └────────┴────────┴────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

**Components Used:**
- `Tabs` from shadcn/ui for sub-navigation
- `Button` with icon variants for actions
- `Popover` + `Calendar` for date picker
- Custom date navigation with ChevronLeft/ChevronRight icons

**Design Tokens:**
- Background: `bg-card` with `border-b`
- Tabs: `text-muted-foreground` inactive, `text-foreground` active with underline
- Buttons: `variant="outline"` for Print/Report, `variant="default"` for Publish

---

### 2.2 Resources Panel (Left Sidebar)

**File:** `components/dispatch/ResourcesPanel.tsx`

```
┌─────────────────────────────────┐
│ Resources                 🔍 ⚙  │
├─────────────────────────────────┤
│ ┌─────────────┬───────────────┐ │
│ │ Trucks (6)  │   Crew (8)    │ │
│ └─────────────┴───────────────┘ │
├─────────────────────────────────┤
│                                 │
│  ┌───────────────────────────┐  │
│  │ 🚚 Boot Truck             │  │
│  │    1975 ft³  •  1 crew    │  │
│  │    ┌──────┐ ┌──────┐      │  │
│  │    │ Attic│ │ Ramp │      │  │
│  │    └──────┘ └──────┘      │  │
│  │    25.75 hrs today   ●    │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 🚚 MV-J (John's Truck)    │  │
│  │    1790 ft³  •  1 crew    │  │
│  │    ┌─────────┐ ┌──────┐   │  │
│  │    │Lift gate│ │ Ramp │   │  │
│  │    └─────────┘ └──────┘   │  │
│  │    0 hrs today       ○    │  │
│  └───────────────────────────┘  │
│                                 │
│  ... more trucks ...            │
│                                 │
├─────────────────────────────────┤
│  ┌─────────────────────────┐    │
│  │  + Add Rental Truck     │    │
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

**Truck Card Component:** `components/dispatch/TruckCard.tsx`

**Features:**
- Draggable to timeline (as assignment)
- Colored left border indicating truck status
- Badge chips for capabilities (Attic, Ramp, Lift gate)
- Hours worked indicator with availability dot
- Three-dot menu for edit/remove actions
- Subtle hover state with `hover:bg-accent`

**Crew Tab Content:** `components/dispatch/CrewList.tsx`

```
┌───────────────────────────────┐
│  ┌─────────────────────────┐  │
│  │ 👤 John Smith           │  │
│  │    Driver • Available   │  │
│  │    8 hrs today     ●    │  │
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │ 👤 Fernando B           │  │
│  │    Mover • On Job       │  │
│  │    4.5 hrs today   ●    │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

**Design Tokens:**
- Panel: `bg-card`, `border-r`, `w-60`
- Cards: `bg-background`, `border`, `rounded-lg`, `shadow-xs`
- Badges: `variant="secondary"`, small text
- Status dot: Green (`bg-green-500`) = available, Yellow = on job, Gray = unavailable

---

### 2.3 Schedule Timeline (Main Area)

**File:** `components/dispatch/ScheduleTimeline.tsx`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Templates ▼                                                                  │
├──────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┬──────────┤
│          │  8am  │  9am  │ 10am  │ 11am  │ 12pm  │  1pm  │  2pm  │   ...    │
├──────────┼───────┴───────┴───────┴───────┴───────┴───────┴───────┴──────────┤
│ Multi-day│ ┌─────────────────────────────────────────────────────────────┐  │
│ jobs     │ │ ○ 7728-1 • Jim Sturdevanr                    Drop: 1/23 │×│ │  │
│          │ │   🏠 3BR House (2200 SQFT)  📍 Portland → Hillsboro        │  │
│          │ │   🚚 MV-S  👥 4 crew  ⏰ 7:45a                              │  │
│          │ └─────────────────────────────────────────────────────────────┘  │
│          │ ┌───────────────────────────────────────┐                        │
│          │ │ ○ 7702-1 • Zachary Kovitch   97123   │                        │
│          │ │   🏠 2BR Apt  📍 Portland → Hillsboro │                        │
│          │ └───────────────────────────────────────┘                        │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ Boot     │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ Truck    │                                                                   │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ MV-J     │            ┌────────────────────────────────┐                    │
│          │            │  ○ 7715-1 • Sarah Connor      │                    │
│          │            │    🏠 1BR  📍 Local            │                    │
│          │            └────────────────────────────────┘                    │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ MV-S     │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ Spaceship│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ + Add    │                                                                   │
│   Slot   │                                                                   │
└──────────┴──────────────────────────────────────────────────────────────────┘
```

**Sub-Components:**

#### Timeline Header: `components/dispatch/TimelineHeader.tsx`
- Hour markers with current time indicator (red line)
- Sticky header on scroll
- Half-hour grid lines (subtle)

#### Timeline Row: `components/dispatch/TimelineRow.tsx`
- Truck/resource label on left (sticky)
- Droppable zone for job cards
- Visual drop indicator on drag-over
- Empty state pattern (subtle diagonal stripes)

#### Job Card: `components/dispatch/JobCard.tsx`
```
┌─────────────────────────────────────────────────────────────┐
│ ○ 7728-1 • Jim Sturdevanr                     Drop: 1/23  × │
│ 🏠 3 Bedroom House (Under 2200 SQFT)                  97024 │
│ 📍 Portland, OR → Hillsboro, OR                             │
│ 🚚 MV-S (Shawn's Truck)  👥 4  ⏰ 7:45a                      │
│ ┌────────────┬────────────┬────────────┬────────────┐       │
│ │ Elijah G   │ Fernando B │ Joshua C   │ Shawn T    │       │
│ └────────────┴────────────┴────────────┴────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**Job Card Features:**
- Draggable (horizontal for time, vertical for truck reassignment)
- Resizable (drag edges to adjust duration)
- Color-coded by status (scheduled, in-progress, completed)
- Expandable to show full crew list
- Quick actions on hover (edit, remove, duplicate)
- Double-click to open job details modal

**Design Tokens:**
- Card: `bg-blue-50 dark:bg-blue-950`, `border-l-4 border-blue-500`
- In-progress: `bg-amber-50`, `border-amber-500`
- Completed: `bg-green-50`, `border-green-500`
- Hover: `ring-2 ring-primary/50`
- Dragging: `opacity-50`, `shadow-lg`, `rotate-1`

---

### 2.4 Jobs Panel (Right Sidebar)

**File:** `components/dispatch/JobsPanel.tsx`

```
┌─────────────────────────────────┐
│ Jobs                     Filters│
│ ┌────────────────────────────┐  │
│ │ 15% Booked Today           │  │
│ │ ████░░░░░░░░░░░░░░░░░░░░░  │  │
│ └────────────────────────────┘  │
├─────────────────────────────────┤
│ ┌────────────┬────────────────┐ │
│ │Unscheduled │   Cancelled    │ │
│ │    (3)     │      (1)       │ │
│ └────────────┴────────────────┘ │
├─────────────────────────────────┤
│                                 │
│  ┌───────────────────────────┐  │
│  │ 🔵 7731-2                 │  │
│  │ Mike Johnson              │  │
│  │ 🏠 2BR Apt • 800 SQFT     │  │
│  │ 📍 Portland → Beaverton   │  │
│  │ 📅 Flexible               │  │
│  │ ⏱ Est. 4 hours            │  │
│  │                    ⋮      │  │
│  └───────────────────────────┘  │
│        ↕ DRAG TO SCHEDULE       │
│  ┌───────────────────────────┐  │
│  │ 🟡 7732-1                 │  │
│  │ Lisa Park                 │  │
│  │ 🏠 3BR House • 1800 SQFT  │  │
│  │ 📅 Preferred: 1/22        │  │
│  │ ⏱ Est. 6 hours            │  │
│  └───────────────────────────┘  │
│                                 │
│  ... more jobs ...              │
│                                 │
└─────────────────────────────────┘
```

**Unscheduled Job Card:** `components/dispatch/UnscheduledJobCard.tsx`

**Features:**
- Draggable to timeline
- Priority indicator (color dot)
- Quick job info preview
- Estimated duration for planning
- Preferred date badge if specified
- Drag handle on hover

**Filters Popover:**
- Move size filter
- Service type filter
- Date range filter
- Customer search

**Design Tokens:**
- Panel: `bg-card`, `border-l`, `w-72`
- Progress bar: `bg-primary/20` track, `bg-primary` fill
- Cards: `bg-background`, `border`, `cursor-grab`
- Dragging: `cursor-grabbing`, `shadow-lg`

---

## 3. Drag & Drop System

**Library:** `@dnd-kit/core` + `@dnd-kit/sortable`

### Drag Sources:
1. **Unscheduled jobs** (Jobs Panel) → Timeline rows
2. **Scheduled jobs** (Timeline) → Different time/truck
3. **Trucks** (Resources) → Job cards (assign truck)
4. **Crew members** (Resources) → Job cards (assign crew)

### Drop Targets:
1. **Timeline rows** - Accept jobs, show time preview
2. **Job cards** - Accept trucks/crew for assignment
3. **Unscheduled panel** - Accept jobs to unschedule

### Visual Feedback:
```tsx
// Drop indicator styles
const dropIndicatorStyles = {
  valid: "bg-primary/20 border-2 border-dashed border-primary",
  invalid: "bg-destructive/10 border-2 border-dashed border-destructive",
  active: "ring-2 ring-primary ring-offset-2"
}
```

### Collision Detection:
- Use `closestCenter` for precise time slot placement
- Snap to 15-minute intervals
- Show ghost preview of job at target position

---

## 4. Interactions & Animations

### Hover States:
```tsx
// Job card hover
"hover:ring-2 hover:ring-primary/30 hover:shadow-md transition-all duration-150"

// Timeline row hover (empty)
"hover:bg-accent/50"

// Resource card hover
"hover:bg-accent"
```

### Drag Animations (Framer Motion):
```tsx
const dragAnimations = {
  initial: { scale: 1, rotate: 0 },
  dragging: { scale: 1.02, rotate: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.15)" },
  dropping: { scale: 1, rotate: 0 }
}
```

### Timeline Scroll:
- Horizontal scroll for time (mouse wheel + shift, or trackpad)
- Current time auto-scroll on load
- Smooth scroll to job on selection

### Resize Interaction:
- Drag left/right edges of job card
- Show duration tooltip while resizing
- Snap to 15-minute increments
- Min duration: 1 hour

---

## 5. Responsive Behavior

### Desktop (≥1280px):
- Full three-panel layout
- All features visible

### Tablet (768px - 1279px):
- Collapsible Resources panel (icon-only mode)
- Jobs panel slides over timeline
- Touch-optimized drag handles

### Mobile (<768px):
- Single panel view with bottom sheet navigation
- Swipe between Resources → Timeline → Jobs
- Simplified job cards
- Pull-to-refresh for updates

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `←` `→` | Navigate between days |
| `T` | Jump to today |
| `N` | New job |
| `F` | Open filters |
| `P` | Print schedule |
| `?` | Show shortcuts help |
| `Esc` | Close modals/cancel drag |

---

## 7. File Structure

```
components/dispatch/
├── schedule/
│   ├── SchedulePage.tsx           # Main page component
│   ├── ScheduleHeader.tsx         # Top header with tabs & date nav
│   ├── ScheduleTimeline.tsx       # Main timeline grid
│   ├── TimelineHeader.tsx         # Hour markers
│   ├── TimelineRow.tsx            # Individual truck row
│   ├── TimelineTodayMarker.tsx    # Red line for current time
│   └── TimelineEmptyState.tsx     # Empty slot visual
├── resources/
│   ├── ResourcesPanel.tsx         # Left sidebar container
│   ├── TruckCard.tsx              # Individual truck card
│   ├── TruckList.tsx              # Trucks tab content
│   ├── CrewCard.tsx               # Individual crew member
│   ├── CrewList.tsx               # Crew tab content
│   └── AddResourceModal.tsx       # Add truck/rental modal
├── jobs/
│   ├── JobsPanel.tsx              # Right sidebar container
│   ├── JobCard.tsx                # Scheduled job on timeline
│   ├── UnscheduledJobCard.tsx     # Unscheduled job in panel
│   ├── JobDetailsModal.tsx        # Full job details
│   ├── JobFilters.tsx             # Filter popover
│   └── BookingProgress.tsx        # % booked indicator
├── dnd/
│   ├── DndContext.tsx             # Drag & drop provider
│   ├── Draggable.tsx              # Draggable wrapper
│   ├── Droppable.tsx              # Droppable zone
│   └── DragOverlay.tsx            # Ghost preview
└── index.ts                       # Exports
```

---

## 8. State Management

```tsx
// Schedule state (React Context or Zustand)
interface ScheduleState {
  selectedDate: Date
  view: 'day' | 'week' | '3day'
  jobs: Job[]
  trucks: Truck[]
  crew: CrewMember[]
  filters: FilterState

  // Actions
  moveJob: (jobId: string, truckId: string, startTime: Date) => void
  resizeJob: (jobId: string, duration: number) => void
  assignTruck: (jobId: string, truckId: string) => void
  assignCrew: (jobId: string, crewIds: string[]) => void
  scheduleJob: (jobId: string, truckId: string, startTime: Date) => void
  unscheduleJob: (jobId: string) => void
}
```

---

## 9. Color System for Job Status

| Status | Background | Border | Icon |
|--------|------------|--------|------|
| Scheduled | `bg-blue-50` | `border-blue-500` | ○ hollow |
| In Progress | `bg-amber-50` | `border-amber-500` | ◐ half |
| Completed | `bg-green-50` | `border-green-500` | ● filled |
| Cancelled | `bg-gray-50` | `border-gray-300` | ✕ cross |
| Needs Attention | `bg-red-50` | `border-red-500` | ⚠ warning |

---

## 10. Accessibility

- All interactive elements have focus states
- Keyboard navigation for timeline (arrow keys)
- Screen reader announcements for drag operations
- High contrast mode support via dark theme
- ARIA labels on all controls
- Role="grid" for timeline with proper row/cell roles

---

## 11. Dependencies to Add

```json
{
  "@dnd-kit/core": "^6.1.0",
  "@dnd-kit/sortable": "^8.0.0",
  "@dnd-kit/utilities": "^3.2.2",
  "date-fns": "^3.6.0"  // Already likely installed
}
```

---

## 12. Implementation Phases

### Phase 1: Static UI (Week 1)
- [ ] Create all component shells with mock data
- [ ] Implement layout structure
- [ ] Style all components to match design system
- [ ] Responsive breakpoints

### Phase 2: Drag & Drop (Week 2)
- [ ] Integrate @dnd-kit
- [ ] Job scheduling (panel → timeline)
- [ ] Job rescheduling (timeline → timeline)
- [ ] Visual feedback and animations

### Phase 3: Data Integration (Week 3)
- [ ] Connect to backend APIs
- [ ] Real-time updates (WebSocket/polling)
- [ ] Optimistic updates
- [ ] Error handling

### Phase 4: Polish (Week 4)
- [ ] Keyboard shortcuts
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] Mobile refinements

---

## 13. Mockup Reference

The design should feel like a modern Notion/Linear-style interface:
- Clean, minimal chrome
- Generous whitespace
- Smooth micro-interactions
- Contextual actions (appear on hover)
- Subtle shadows and borders
- Consistent 4px/8px spacing grid

---

## Design Decisions (Confirmed)

| Question | Decision |
|----------|----------|
| Multi-day jobs display | Single card with date range badge (e.g., "Jan 20-23") |
| View modes | Day view only (no week view) |
| Crew assignment | Drag-and-drop from crew list to job cards |
| Real-time sync | Not needed yet (polling/refresh on action) |
| Time intervals | 15-minute increments |

---

## 14. Detailed Time Grid Specification

### 15-Minute Grid System

```
Timeline width calculation:
- Hours displayed: 6am - 8pm = 14 hours
- Intervals per hour: 4 (15-min each)
- Total intervals: 56
- Min interval width: 30px
- Total min width: 1680px (scrollable)
```

### Visual Grid:

```
│ 8:00 │ 8:15 │ 8:30 │ 8:45 │ 9:00 │ 9:15 │ ...
│      │  ·   │  ·   │  ·   │      │  ·   │
├──────┼──────┼──────┼──────┼──────┼──────┼
│ Hour │ 15m  │ 30m  │ 45m  │ Hour │ 15m  │
│ line │ dot  │ dot  │ dot  │ line │ dot  │
```

- **Hour lines**: Solid, `border-border`
- **15-min markers**: Dotted/dashed, `border-border/30`
- **Snap behavior**: Jobs snap to nearest 15-min when dropped/resized
