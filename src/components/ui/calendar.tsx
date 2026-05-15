"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayButton, DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

export type Booking = {
  date: Date;
  name: string;
};

type CalendarProps = DayPickerProps & {
  bookings?: Booking[];
};

function Calendar({ 
  className, 
  classNames, 
  bookings = [], 
  showOutsideDays = true, 
  ...props 
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames();

  // Optimasi: Mapping booking berdasarkan string tanggal (YYYY-MM-DD)
  const bookingMap = React.useMemo(() => {
    const map = new Map<string, string>();
    bookings.forEach((b) => {
      const dateKey = b.date.toISOString().split('T')[0];
      map.set(dateKey, b.name);
    });
    return map;
  }, [bookings]);

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0", defaultClassNames.months),
        month: cn("space-y-4", defaultClassNames.month),
        nav: cn("flex items-center justify-between pt-1", defaultClassNames.nav),
        button_previous: cn(buttonVariants({ variant: "outline" }), "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"),
        button_next: cn(buttonVariants({ variant: "outline" }), "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"),
        month_caption: cn("flex justify-center pt-1 relative items-center font-medium", defaultClassNames.month_caption),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn("text-muted-foreground rounded-md w-10 font-normal text-[0.8rem]", defaultClassNames.weekday),
        week: cn("flex w-full mt-2", defaultClassNames.week),
        day: cn("h-14 w-10 p-0 font-normal", defaultClassNames.day),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />,
        DayButton: (props) => (
          <CalendarDayButton 
            {...props} 
            bookingName={bookingMap.get(props.day.date.toISOString().split('T')[0])} 
          />
        ),
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  day,
  bookingName,
  className,
  ...props
}: React.ComponentProps<typeof DayButton> & { bookingName?: string }) {
  
  return (
    <Button
      variant="ghost"
      className={cn(
        "h-14 w-10 flex flex-col items-center justify-start pt-2 gap-1 font-normal aria-selected:opacity-100",
        bookingName && "bg-blue-50 hover:bg-blue-100 border border-blue-200",
        className
      )}
      {...props}
    >
      <span className="text-xs leading-none">{day.date.getDate()}</span>
      {bookingName && (
        <span className="text-[8px] font-bold text-blue-700 leading-tight truncate w-full px-0.5 rounded bg-blue-100/50">
          {bookingName}
        </span>
      )}
    </Button>
  );
}

export { Calendar };