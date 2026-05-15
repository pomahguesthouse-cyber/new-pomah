import React from "react";
import { format, isToday } from "date-fns";
import { id } from "date-fns/locale";
import { cn } from "@/lib/utils";

// Fungsi helper untuk format mata uang
const formatIDR = (amount: number) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
};

export default function CalendarGrid({ 
  days, 
  rooms, 
  roomTypes, 
  bookings, 
  onCellClick, 
  onBookingClick 
}: any) {
  const cellWidth = 110;
  const labelWidth = 180;

  return (
    <div className="rounded-xl border border-border bg-card shadow-xl overflow-hidden">
      {/* Container scroll utama. 
          max-h-[75vh] agar header admin di atas tidak terdorong hilang.
      */}
      <div className="overflow-auto max-h-[75vh] relative">
        <div style={{ minWidth: labelWidth + days.length * cellWidth }} className="relative">
          
          {/* --- HEADER TANGGAL (STICKY TOP) --- */}
          <div className="flex sticky top-0 z-40 bg-card border-b border-border">
            
            {/* POJOK KIRI ATAS: Label "UNIT" (STICKY TOP & LEFT) */}
            <div 
              style={{ width: labelWidth }} 
              className="shrink-0 px-4 py-5 text-[11px] font-black uppercase tracking-widest text-muted-foreground flex items-end sticky left-0 z-50 bg-card border-r border-border"
            >
              UNIT / KAMAR
            </div>

            {/* LIST TANGGAL */}
            {days.map((d: Date) => (
              <div 
                key={d.toISOString()} 
                style={{ width: cellWidth }} 
                className={cn(
                  "shrink-0 border-l border-border px-1 py-3 text-center transition-all",
                  isToday(d) ? "bg-primary/5" : ""
                )}
              >
                <div className={cn(
                  "text-[10px] font-bold uppercase mb-1",
                  isToday(d) ? "text-primary" : "text-muted-foreground/70"
                )}>
                  {format(d, "EEEE", { locale: id })}
                </div>
                <div className={cn(
                  "text-xl font-black leading-none",
                  isToday(d) ? "text-primary" : "text-foreground"
                )}>
                  {format(d, "dd")}
                </div>
              </div>
            ))}
          </div>

          {/* --- BODY: DAFTAR TIPE & NOMOR UNIT --- */}
          {roomTypes.map((type: any) => (
            <div key={type.id} className="group">
              {/* SUB-HEADER TIPE KAMAR (STICKY LEFT agar judul tipe tak hilang) */}
              <div className="flex bg-muted/40 border-b border-border px-4 py-2 text-[9px] font-black text-foreground/40 uppercase tracking-widest items-center">
                <div className="sticky left-4 z-20">
                  {type.name} <span className="mx-2 opacity-30">|</span> {formatIDR(type.base_rate)}
                </div>
              </div>
              
              {/* LIST PER UNIT */}
              {rooms.filter((r: any) => r.room_type_id === type.id).map((room: any) => (
                <div key={room.id} className="relative flex border-b border-border h-[64px] hover:bg-muted/5 transition-colors group/row">
                  
                  {/* LABEL NOMOR UNIT (STICKY LEFT) */}
                  <div 
                    style={{ width: labelWidth }} 
                    className="flex shrink-0 items-center px-4 border-r border-border font-bold text-sm text-foreground/80 sticky left-0 z-30 bg-card group-hover/row:bg-muted/10 transition-colors"
                  >
                     Unit {room.number}
                  </div>

                  {/* GRID CELLS (TEMPAT KLIK BOOKING) */}
                  {days.map((d: Date) => (
                    <button 
                      key={d.toISOString()} 
                      onClick={() => onCellClick(room.id, d)} 
                      style={{ width: cellWidth }} 
                      className={cn(
                        "shrink-0 border-l border-border/50 transition-colors focus:outline-none hover:bg-primary/[0.02]",
                        isToday(d) ? "bg-primary/[0.03]" : ""
                      )} 
                    />
                  ))}

                  {/* RENDER BOOKING BARS 
                      Logika penempatan baris booking tetap sama menggunakan absolute positioning 
                  */}
                  {/* ... renderBookingBars(room.id) ... */}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}