import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  allowNegativeNumeric,
  commitNumericValue,
  isAllowedNumericDraft,
  numericDraftAfterChange,
  type NumericCommitOptions,
} from "@/lib/numeric-input";

export type NumericInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "inputMode" | "min" | "max"
> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Applied when the field is cleared. Defaults to 0. A non-zero fallback also replaces a typed 0 (`|| fallback`). */
  emptyValue?: number;
  min?: number;
  max?: number;
  /** Decimal point allowed. Uses `inputMode="decimal"`. Integers use `inputMode="numeric"`. */
  allowDecimal?: boolean;
  /** Select the current text on focus so typing replaces a leading 0. Default true. */
  selectAllOnFocus?: boolean;
};

function formatValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

/**
 * Numeric field that can be cleared while it is focused.
 * The parent still receives a number (the previous fallback) so totals,
 * validation, and saved values stay the same. Blur clamps to min/max.
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput(
    {
      value,
      onValueChange,
      emptyValue = 0,
      min,
      max,
      allowDecimal = false,
      selectAllOnFocus = true,
      onFocus,
      onBlur,
      onMouseUp,
      onKeyDown,
      ...rest
    },
    ref,
  ) {
    const [draft, setDraft] = React.useState<string | null>(null);
    const draftRef = React.useRef("");
    const focusedRef = React.useRef(false);
    const emittedRef = React.useRef<number | null>(null);
    const selectOnMouseUpRef = React.useRef(false);

    const showDraft = (next: string | null) => {
      draftRef.current = next ?? "";
      setDraft(next);
    };

    const options = React.useMemo<NumericCommitOptions>(
      () => ({ allowDecimal, emptyValue, min, max }),
      [allowDecimal, emptyValue, min, max],
    );
    const allowNegative = allowNegativeNumeric(min);

    React.useEffect(() => {
      if (!focusedRef.current) return;
      if (!Number.isFinite(value)) return;
      if (Object.is(value, emittedRef.current)) return;
      emittedRef.current = value;
      const shown = String(value);
      draftRef.current = shown;
      setDraft(shown);
    }, [value]);

    const emit = (next: number) => {
      emittedRef.current = next;
      onValueChange(next);
    };

    const display = draft !== null ? draft : formatValue(value);

    return (
      <Input
        ref={ref}
        {...rest}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        pattern={allowNegative ? undefined : allowDecimal ? "[0-9]*[.]?[0-9]*" : "[0-9]*"}
        autoComplete="off"
        spellCheck={false}
        min={min}
        max={max}
        value={display}
        onFocus={(e) => {
          focusedRef.current = true;
          emittedRef.current = Number.isFinite(value) ? value : null;
          showDraft(formatValue(value));
          if (selectAllOnFocus) {
            selectOnMouseUpRef.current = true;
            const el = e.currentTarget;
            requestAnimationFrame(() => el.select());
          }
          onFocus?.(e);
        }}
        onMouseUp={(e) => {
          if (selectOnMouseUpRef.current) {
            e.preventDefault();
            selectOnMouseUpRef.current = false;
          }
          onMouseUp?.(e);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (!isAllowedNumericDraft(raw, { allowDecimal, allowNegative })) return;
          const next = commitNumericValue(raw, { ...options, phase: "edit" });
          showDraft(numericDraftAfterChange(raw, next, options));
          emit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            emit(commitNumericValue(draftRef.current, { ...options, phase: "commit" }));
          }
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          focusedRef.current = false;
          selectOnMouseUpRef.current = false;
          const next = commitNumericValue(draftRef.current, { ...options, phase: "commit" });
          showDraft(null);
          emit(next);
          onBlur?.(e);
        }}
      />
    );
  },
);
