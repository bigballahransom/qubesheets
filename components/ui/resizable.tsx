"use client"

import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

// react-resizable-panels v4 renamed the primitives (PanelGroup → Group,
// PanelResizeHandle → Separator) and switched `direction` → `orientation`,
// numeric sizes → string sizes with units ("50%"). The shadcn wrapper API
// stays stable across the two versions; only the internals change.

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // Base (side-by-side panels = vertical separator; the lib sets
        // aria-orientation="vertical" on the separator): 1px wide line
        // with a 6px-wide hit target expanded via ::after.
        "group bg-border focus-visible:ring-ring relative flex w-px items-center justify-center transition-colors hover:bg-primary/40 after:absolute after:inset-y-0 after:left-1/2 after:w-1.5 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden",
        // Top/bottom panels = horizontal separator (aria-orientation="horizontal"):
        // flip the same idea 90° — thin horizontal line, wide hit target.
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-background z-10 flex h-4 w-4 items-center justify-center rounded-sm border shadow-sm transition-colors group-hover:border-primary/60 group-hover:bg-primary/10 [[aria-orientation=horizontal]_&]:h-3 [[aria-orientation=horizontal]_&]:w-6 [[aria-orientation=horizontal]_&]:rotate-90">
          <GripVerticalIcon className="size-2.5 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
