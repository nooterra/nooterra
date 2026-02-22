import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../../lib/utils.js";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex w-full flex-wrap items-center gap-1 rounded-2xl border border-[#2c4f67] bg-[rgba(9,27,42,0.8)] p-1 text-[#bdd4e8]",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex min-w-[110px] flex-1 items-center justify-center whitespace-nowrap rounded-xl px-2 py-2 text-xs font-semibold transition-all sm:px-3 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4ce0bf]/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[linear-gradient(135deg,#1bc5a3,#33d7b4)] data-[state=active]:text-[#072330] data-[state=active]:shadow",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4ce0bf]/40", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
