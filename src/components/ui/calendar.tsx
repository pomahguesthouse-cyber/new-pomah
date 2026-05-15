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

interface CalendarProps extends DayPickerProps {
  bookings?: Booking[];
}

function Calendar({ className, classNames, bookings = [], ...props }: CalendarProps) {
  const defaultClassNames = getDefaultClassNames();
  
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
      className={cn("p-3", className)}
      classNames={{
        ...defaultClassNames,
        day: cn("h-14 w-10 p-0 font-normal relative"),
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

function CalendarDayButton({ day, bookingName, className, ...props }: any) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "h-14 w-10 flex flex-col items-center justify-start pt-1 gap-0.5 relative",
        bookingName && "bg-blue-50/50",
        className
      )}
      {...props}
    >
      <span className="text-[10px]">{day.date.getDate()}</span>
      {bookingName && (
        <span className="text-[7px] font-bold text-blue-700 truncate w-full bg-blue-100/80 px-0.5 rounded-sm">
          {bookingName}
        </span>
      )}
    </Button>
  );
}

export { Calendar };