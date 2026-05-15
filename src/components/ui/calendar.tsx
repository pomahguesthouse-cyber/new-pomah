"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { id } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Calendar({ bookings = [], ...props }: any) {
  const bookingMap = React.useMemo(() => {
    const map = new Map();
    bookings.forEach((b: any) => map.set(b.date.toISOString().split('T')[0], b.name));
    return map;
  }, [bookings]);

  return (
    <DayPicker
      locale={id} // Menggunakan locale Indonesia
      components={{
        DayButton: (props) => {
          const dateKey = props.day.date.toISOString().split('T')[0];
          const name = bookingMap.get(dateKey);
          return (
            <Button
              variant="ghost"
              className={cn("h-14 w-10 flex flex-col items-center pt-1 relative font-normal", name && "bg-blue-50")}
              {...props}
            >
              <span className="text-[10px]">{props.day.date.getDate()}</span>
              {name && (
                <span className="text-[7px] font-bold text-blue-700 truncate w-full bg-blue-100 px-0.5 rounded-sm">
                  {name}
                </span>
              )}
            </Button>
          );
        },
      }}
      {...props}
    />
  );
}